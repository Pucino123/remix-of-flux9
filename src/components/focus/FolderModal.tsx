import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FolderPlus, FileText, Table,
  ChevronRight, LayoutGrid, List, Folder, ArrowLeft, Search, SlidersHorizontal,
  Sparkles, Sun, Moon,
} from "lucide-react";
import { useFlux, FolderNode } from "@/context/FluxContext";
import { useDocuments, DbDocument } from "@/hooks/useDocuments";
import { FOLDER_ICONS } from "@/components/CreateFolderModal";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import FolderContents from "./FolderContents";
import FolderTemplateSelector from "./FolderTemplateSelector";
import DocumentView from "@/components/documents/DocumentView";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type FilterChip = "all" | "folders" | "documents";
type SortMode = "name" | "date" | "type";

interface FolderModalProps {
  folderId: string;
  onClose: () => void;
}

const FolderModal = ({ folderId, onClose }: FolderModalProps) => {
  const { findFolderNode, updateFolder, removeFolder, createFolder, moveFolder, createBlock, folderTree } = useFlux();

  const [navStack, setNavStack] = useState<string[]>([folderId]);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const [openDocument, setOpenDocument] = useState<DbDocument | null>(null);
  const [renamingDoc, setRenamingDoc] = useState(false);
  const [renameDocValue, setRenameDocValue] = useState("");

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterChip, setFilterChip] = useState<FilterChip>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name");
  const [showSort, setShowSort] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [folderLightMode, setFolderLightMode] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const currentFolderId = navStack[navStack.length - 1];
  const currentFolder = findFolderNode(currentFolderId);

  const { documents, loading: docsLoading, createDocument, updateDocument, removeDocument } = useDocuments(currentFolderId);

  // Filter & sort
  const filteredData = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let subs = currentFolder?.children || [];
    let docs = documents;

    if (q) {
      subs = subs.filter((s) => s.title.toLowerCase().includes(q));
      docs = docs.filter((d) => d.title.toLowerCase().includes(q));
    }

    if (filterChip === "folders") docs = [];
    if (filterChip === "documents") subs = [];

    // Sort
    const sortStr = (a: string, b: string) => a.localeCompare(b);
    if (sortMode === "name") {
      subs = [...subs].sort((a, b) => sortStr(a.title, b.title));
      docs = [...docs].sort((a, b) => sortStr(a.title, b.title));
    } else if (sortMode === "date") {
      docs = [...docs].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    } else if (sortMode === "type") {
      docs = [...docs].sort((a, b) => sortStr(a.type, b.type));
    }

    return { subfolders: subs, documents: docs };
  }, [currentFolder?.children, documents, searchQuery, filterChip, sortMode]);

  const breadcrumbs = useMemo(() => {
    const crumbs: { id: string; title: string }[] = [];
    for (const id of navStack) {
      const node = findFolderNode(id);
      if (node) crumbs.push({ id: node.id, title: node.title });
    }
    return crumbs;
  }, [navStack, findFolderNode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (searchQuery) {
          setSearchQuery("");
        } else if (openDocument) {
          setOpenDocument(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, openDocument, searchQuery]);

  const drillIn = useCallback((childId: string) => {
    setDirection(1);
    setNavStack((prev) => [...prev, childId]);
    setOpenDocument(null);
    setSearchQuery("");
  }, []);

  const navigateTo = useCallback((index: number) => {
    if (index >= navStack.length - 1) return;
    setDirection(-1);
    setNavStack((prev) => prev.slice(0, index + 1));
    setOpenDocument(null);
    setSearchQuery("");
  }, [navStack.length]);

  const startRename = () => {
    if (!currentFolder) return;
    setRenameValue(currentFolder.title);
    setRenaming(true);
  };
  const commitRename = () => {
    if (renameValue.trim() && currentFolder && renameValue.trim() !== currentFolder.title) {
      updateFolder(currentFolderId, { title: renameValue.trim() });
    }
    setRenaming(false);
  };

  const commitDocRename = () => {
    if (openDocument && renameDocValue.trim() && renameDocValue.trim() !== openDocument.title) {
      updateDocument(openDocument.id, { title: renameDocValue.trim() });
      setOpenDocument((prev) => prev ? { ...prev, title: renameDocValue.trim() } : null);
    }
    setRenamingDoc(false);
  };

  const handleCreateSubfolder = async () => {
    await createFolder({ parent_id: currentFolderId, title: "New Folder", type: "folder" });
  };
  const handleCreateDocument = async (type: "text" | "spreadsheet") => {
    await createDocument(type === "text" ? "Untitled Document" : "Untitled Spreadsheet", type, currentFolderId);
  };
  const handleCreateFromTemplate = async (title: string, type: "text" | "spreadsheet", content?: any) => {
    if (!createDocument) return;
    const doc = await createDocument(title, type, currentFolderId);
    if (doc && content) {
      updateDocument(doc.id, { content });
    }
  };

  const handleOpenDocument = (doc: DbDocument) => {
    setOpenDocument(doc);
  };
  const handleMoveFolder = (draggedId: string, targetId: string) => {
    moveFolder(draggedId, targetId);
    toast.success("Folder moved");
  };

  if (!currentFolder) return null;

  const customIcon = currentFolder.icon ? FOLDER_ICONS.find((i) => i.name === currentFolder.icon) : null;
  const IconComp = customIcon ? customIcon.icon : Folder;
  const iconColor = currentFolder.color || "hsl(var(--muted-foreground))";

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="folder-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md"
        onClick={onClose}
      />
      <motion.div
        key="folder-modal"
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-[101] flex items-center justify-center p-4 pointer-events-none"
      >
        <div
          ref={modalRef}
          className={`relative w-full max-w-4xl max-h-[85vh] flex flex-col backdrop-blur-2xl border rounded-2xl shadow-2xl pointer-events-auto overflow-hidden transition-colors duration-300 ${
            folderLightMode
              ? "bg-white/95 border-gray-200/60 text-gray-900"
              : "bg-card/80 border-border/50"
          }`}
          onClick={(e) => e.stopPropagation()}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("modal-folder-id")) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onDrop={(e) => {
            if (e.dataTransfer.types.includes("modal-folder-id")) {
              e.stopPropagation();
            }
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            {(navStack.length > 1 || openDocument) && !renaming && (
              <button
                onClick={() => {
                  if (openDocument) {
                    setOpenDocument(null);
                  } else {
                    navigateTo(navStack.length - 2);
                  }
                }}
                className={`p-2 rounded-lg transition-colors ${folderLightMode ? "text-gray-500 hover:bg-gray-100 hover:text-gray-800" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
              >
                <ArrowLeft size={16} />
              </button>
            )}

            {openDocument ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {openDocument.type === "text" ? (
                  <FileText size={18} className="text-blue-400 shrink-0" />
                ) : (
                  <Table size={18} className="text-emerald-500 shrink-0" />
                )}
                {renamingDoc ? (
                  <input
                    value={renameDocValue}
                    onChange={(e) => setRenameDocValue(e.target.value)}
                    onBlur={() => commitDocRename()}
                    onKeyDown={(e) => { if (e.key === "Enter") commitDocRename(); if (e.key === "Escape") setRenamingDoc(false); }}
                    className={`flex-1 text-lg font-semibold bg-transparent border-b-2 border-primary/40 outline-none ${folderLightMode ? "text-gray-900" : "text-foreground"}`}
                    autoFocus
                  />
                ) : (
                  <span
                    className={`text-lg font-semibold truncate cursor-pointer transition-colors ${folderLightMode ? "text-gray-900 hover:text-primary" : "text-foreground hover:text-primary"}`}
                    onClick={() => { setRenameDocValue(openDocument.title); setRenamingDoc(true); }}
                    title="Click to rename"
                  >
                    {openDocument.title}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${iconColor}15` }}
                >
                  <IconComp size={20} style={{ color: iconColor }} strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  {renaming ? (
                    <input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenaming(false);
                      }}
                      className={`w-full text-lg font-semibold bg-transparent border-b-2 border-primary/40 outline-none ${folderLightMode ? "text-gray-900" : "text-foreground"}`}
                      autoFocus
                    />
                  ) : (
                    <h2
                      className={`text-lg font-semibold truncate cursor-pointer transition-colors ${folderLightMode ? "text-gray-900 hover:text-primary" : "text-foreground hover:text-primary"}`}
                      onClick={startRename}
                      title="Click to rename"
                    >
                      {currentFolder.title}
                    </h2>
                  )}
                </div>
                <button
                  onClick={() => setFolderLightMode(!folderLightMode)}
                  className={`p-2 rounded-lg transition-colors ${folderLightMode ? "hover:bg-gray-100 text-gray-500 hover:text-gray-700" : "hover:bg-secondary/60 text-muted-foreground hover:text-foreground"}`}
                  title={folderLightMode ? "Dark mode" : "Light mode"}
                >
                  {folderLightMode ? <Moon size={16} /> : <Sun size={16} />}
                </button>
                <button
                  onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
                  className={`p-2 rounded-lg transition-colors ${folderLightMode ? "hover:bg-gray-100 text-gray-500 hover:text-gray-700" : "hover:bg-secondary/60 text-muted-foreground hover:text-foreground"}`}
                  title={viewMode === "grid" ? "List view" : "Grid view"}
                >
                  {viewMode === "grid" ? <List size={16} /> : <LayoutGrid size={16} />}
                </button>
              </>
            )}

            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${folderLightMode ? "text-gray-500 hover:bg-gray-100 hover:text-gray-800" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
            >
              <X size={16} />
            </button>
          </div>

          {/* Breadcrumb */}
          {!openDocument && breadcrumbs.length > 1 && (
            <div className={`flex items-center gap-1 px-5 pb-2 text-xs overflow-x-auto ${folderLightMode ? "text-gray-500" : "text-muted-foreground"}`}>
              {breadcrumbs.map((crumb, i) => (
                <React.Fragment key={crumb.id}>
                  {i > 0 && <ChevronRight size={12} className="shrink-0 opacity-40" />}
                  {i < breadcrumbs.length - 1 ? (
                    <button onClick={() => navigateTo(i)} className={`transition-colors truncate max-w-[120px] ${folderLightMode ? "hover:text-gray-800" : "hover:text-foreground"}`}>
                      {crumb.title}
                    </button>
                  ) : (
                    <span className={`font-medium truncate max-w-[120px] ${folderLightMode ? "text-gray-900" : "text-foreground"}`}>{crumb.title}</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Search bar + filter chips + create actions */}
          {!openDocument && (
            <div className="px-5 pb-3 space-y-2.5">
              <div className="relative">
                <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${folderLightMode ? "text-gray-400" : "text-muted-foreground/50"}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search folders & documents..."
                  className={`w-full h-9 pl-9 pr-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all ${
                    folderLightMode
                      ? "bg-gray-100 border border-gray-200 text-gray-900 placeholder:text-gray-400"
                      : "bg-secondary/40 border border-border/30 text-foreground placeholder:text-muted-foreground/50"
                  }`}
                />
                {searchQuery && (
                  <button
                    onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {(["all", "folders", "documents"] as FilterChip[]).map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setFilterChip(chip)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                      filterChip === chip
                        ? "bg-primary/15 text-primary"
                        : folderLightMode
                          ? "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800"
                          : "bg-secondary/40 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    }`}
                  >
                    {chip === "all" ? "All" : chip === "folders" ? "Folders" : "Documents"}
                  </button>
                ))}

                <Popover open={showSort} onOpenChange={setShowSort}>
                  <PopoverTrigger asChild>
                    <button className={`p-1.5 rounded-lg transition-colors ${folderLightMode ? "text-gray-500 hover:bg-gray-100 hover:text-gray-700" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}>
                      <SlidersHorizontal size={13} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-36 p-1.5 z-[200]" sideOffset={4}>
                    {(["name", "date", "type"] as SortMode[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => { setSortMode(m); setShowSort(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          sortMode === m ? "bg-primary/10 text-primary font-medium" : "hover:bg-secondary text-foreground"
                        }`}
                      >
                        Sort by {m}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>

                <div className="flex-1" />

                <button
                  onClick={handleCreateSubfolder}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${folderLightMode ? "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800" : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                >
                  <FolderPlus size={12} /> Folder
                </button>
                <button
                  onClick={() => handleCreateDocument("text")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${folderLightMode ? "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800" : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                >
                  <FileText size={12} /> Doc
                </button>
                <button
                  onClick={() => handleCreateDocument("spreadsheet")}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors ${folderLightMode ? "bg-gray-100 hover:bg-gray-200 text-gray-600 hover:text-gray-800" : "bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-foreground"}`}
                >
                  <Table size={12} /> Sheet
                </button>
                <button
                  onClick={() => setShowTemplates(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <Sparkles size={12} /> Templates
                </button>
              </div>
            </div>
          )}

          {/* Content area */}
          <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0 relative">
            {openDocument ? (
              <div className="h-full min-h-[400px]">
                <DocumentView
                  document={openDocument}
                  onBack={() => setOpenDocument(null)}
                  onUpdate={(id, updates) => {
                    updateDocument(id, updates);
                    setOpenDocument((prev) => prev ? { ...prev, ...updates } : null);
                  }}
                  onDelete={(id) => {
                    removeDocument(id);
                    setOpenDocument(null);
                  }}
                  lightMode={folderLightMode}
                />
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={currentFolderId}
                  initial={{ opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -40 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <FolderContents
                    subfolders={filteredData.subfolders}
                    documents={filteredData.documents}
                    loading={docsLoading}
                    viewMode={viewMode}
                    searchQuery={searchQuery}
                    lightMode={folderLightMode}
                    modalRef={modalRef as React.RefObject<HTMLDivElement>}
                    onOpenSubfolder={drillIn}
                    onOpenDocument={handleOpenDocument}
                    onCreateFolder={handleCreateSubfolder}
                    onCreateDocument={handleCreateDocument}
                    onMoveFolder={handleMoveFolder}
                    onDragOutDocument={async (doc) => {
                      await (supabase as any).from("documents").update({ folder_id: null }).eq("id", doc.id);
                      toast.success("Document moved to desktop");
                    }}
                    onRenameFolder={(id) => {
                      const node = findFolderNode(id);
                      if (node) {
                        const newName = prompt("Rename folder:", node.title);
                        if (newName?.trim()) updateFolder(id, { title: newName.trim() });
                      }
                    }}
                    onDeleteFolder={(id) => {
                      removeFolder(id);
                      toast.success("Folder deleted");
                    }}
                    onDuplicateFolder={(id) => {
                      const node = findFolderNode(id);
                      if (node) {
                        createFolder({
                          parent_id: node.parent_id,
                          title: `${node.title} (Copy)`,
                          type: node.type,
                          color: node.color || undefined,
                          icon: node.icon || undefined,
                        });
                        toast.success("Folder duplicated");
                      }
                    }}
                    onDeleteDocument={(id) => {
                      removeDocument(id);
                      toast.success("Document deleted");
                    }}
                    onDuplicateDocument={(doc) => {
                      createDocument(doc.title + " (Copy)", doc.type as "text" | "spreadsheet", currentFolderId).then((newDoc) => {
                        if (newDoc && doc.content) {
                          updateDocument(newDoc.id, { content: doc.content });
                        }
                      });
                      toast.success("Document duplicated");
                    }}
                    onAddToCalendar={(doc, date, time) => {
                      createBlock({
                        title: doc.title,
                        time,
                        scheduled_date: date.toISOString().split("T")[0],
                        type: "task",
                        duration: "60m",
                      });
                      toast.success("Added to calendar");
                    }}
                    onMoveDocToFolder={async (doc, folderId) => {
                      if (folderId === "desktop") {
                        await (supabase as any).from("documents").update({ folder_id: null }).eq("id", doc.id);
                        toast.success("Moved to desktop");
                      } else {
                        await (supabase as any).from("documents").update({ folder_id: folderId }).eq("id", doc.id);
                        const targetFolder = findFolderNode(folderId);
                        toast.success(`Moved to ${targetFolder?.title || "folder"}`);
                      }
                    }}
                    onShareDocument={(doc) => {
                      navigator.clipboard.writeText(`${doc.title} — shared from Flux`);
                      toast.success("Link copied to clipboard");
                    }}
                    allFolders={folderTree}
                    currentFolderId={currentFolderId}
                    onUpdateFolder={(id, updates) => {
                      updateFolder(id, updates);
                    }}
                  />
                </motion.div>
              </AnimatePresence>
            )}
          </div>

          {/* Template selector */}
          <FolderTemplateSelector
            open={showTemplates}
            onClose={() => setShowTemplates(false)}
            onCreateDocument={handleCreateFromTemplate}
          />
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

export default FolderModal;
