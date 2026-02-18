import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Folder, FileText, Table, FolderPlus, FolderOpen, Clock, Pencil, Trash2, Copy, ExternalLink, GripVertical, CalendarPlus, FolderInput, Share2, Palette } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { FolderNode } from "@/context/FluxContext";
import { DbDocument } from "@/hooks/useDocuments";
import { FOLDER_ICONS } from "@/components/CreateFolderModal";
import {
  DndContext,
  closestCenter,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface FolderContentsProps {
  subfolders: FolderNode[];
  documents: DbDocument[];
  loading: boolean;
  viewMode: "grid" | "list";
  searchQuery?: string;
  lightMode?: boolean;
  modalRef?: React.RefObject<HTMLDivElement>;
  onOpenSubfolder: (id: string) => void;
  onOpenDocument?: (doc: DbDocument) => void;
  onCreateFolder: () => void;
  onCreateDocument: (type: "text" | "spreadsheet") => void;
  onMoveFolder?: (draggedId: string, targetId: string) => void;
  onRenameFolder?: (id: string) => void;
  onDeleteFolder?: (id: string) => void;
  onDuplicateFolder?: (id: string) => void;
  onDeleteDocument?: (id: string) => void;
  onDuplicateDocument?: (doc: DbDocument) => void;
  onReorderDocuments?: (docs: DbDocument[]) => void;
  onDragOutDocument?: (doc: DbDocument) => void;
  onDragOutFolder?: (folder: FolderNode) => void;
  onAddToCalendar?: (doc: DbDocument, date: Date, time: string) => void;
  onMoveDocToFolder?: (doc: DbDocument, folderId: string) => void;
  onShareDocument?: (doc: DbDocument) => void;
  allFolders?: FolderNode[];
  currentFolderId?: string;
  onUpdateFolder?: (id: string, updates: { color?: string; icon?: string }) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  type: "folder" | "document";
  id: string;
  doc?: DbDocument;
  folder?: FolderNode;
}

const highlightMatch = (text: string, query: string) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/25 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
};

const getDocPreview = (doc: DbDocument): string => {
  if (doc.type === "spreadsheet") {
    const rows = doc.content?.rows;
    if (rows && Array.isArray(rows) && rows.length > 0) {
      return rows.slice(0, 3).map((r: string[]) => r.slice(0, 3).join(" · ")).join(" | ");
    }
    return "Empty spreadsheet";
  }
  const html = doc.content?.html;
  if (!html) return "Empty document";
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 80) + (text.length > 80 ? "…" : "");
};

const formatDate = (date: string) => {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

/* ─── Pure overlay components (no hooks, no ref issues) ─── */

const DocGridOverlay = ({ doc, lm, bgCard, borderColor }: { doc: DbDocument; lm: boolean; bgCard: string; borderColor: string }) => {
  const isSpreadsheet = doc.type === "spreadsheet";
  const preview = getDocPreview(doc);
  return (
    <div
      className={`relative flex flex-col p-4 rounded-2xl ${bgCard} border ${borderColor} text-left`}
      style={{
        transform: "scale(1.05)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.2)",
        cursor: "grabbing",
        willChange: "transform",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isSpreadsheet ? "bg-emerald-500/10" : "bg-blue-400/10"}`}>
          {isSpreadsheet ? <Table size={14} className="text-emerald-500" strokeWidth={1.5} /> : <FileText size={14} className="text-blue-400" strokeWidth={1.5} />}
        </div>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium uppercase tracking-wider ${isSpreadsheet ? "bg-emerald-500/8 text-emerald-500/70" : "bg-blue-400/8 text-blue-400/70"}`}>
          {isSpreadsheet ? "Sheet" : "Doc"}
        </span>
      </div>
      <p className={`text-xs font-semibold truncate mb-1.5 ${lm ? "text-gray-800" : "text-foreground/90"}`}>{doc.title}</p>
      <p className={`text-[10px] leading-relaxed line-clamp-2 mb-3 ${lm ? "text-gray-500" : "text-muted-foreground/50"}`}>{preview}</p>
      <div className="flex items-center gap-1 mt-auto">
        <Clock size={9} className={lm ? "text-gray-300" : "text-muted-foreground/30"} />
        <span className={`text-[9px] ${lm ? "text-gray-400" : "text-muted-foreground/40"}`}>{formatDate(doc.updated_at)}</span>
      </div>
    </div>
  );
};

const DocListOverlay = ({ doc, lm }: { doc: DbDocument; lm: boolean }) => {
  const isSpreadsheet = doc.type === "spreadsheet";
  return (
    <div
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left ${lm ? "bg-white" : "bg-card"}`}
      style={{
        transform: "scale(1.03)",
        boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 6px 16px rgba(0,0,0,0.2)",
        cursor: "grabbing",
        willChange: "transform",
      }}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSpreadsheet ? "bg-emerald-500/8" : "bg-blue-400/8"}`}>
        {isSpreadsheet ? <Table size={16} className="text-emerald-500" /> : <FileText size={16} className="text-blue-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className={`text-[13px] font-medium truncate block ${lm ? "text-gray-800" : "text-foreground/90"}`}>{doc.title}</span>
        <span className={`text-[10px] truncate block ${lm ? "text-gray-400" : "text-muted-foreground/40"}`}>{getDocPreview(doc)}</span>
      </div>
    </div>
  );
};

/* ─── Sortable wrappers ─── */

const SortableDocGrid = ({ doc, searchQuery, lm, bgCard, bgCardHover, borderColor, onOpenDocument, onContextMenu }: {
  doc: DbDocument; searchQuery: string; lm: boolean; bgCard: string; bgCardHover: string; borderColor: string;
  onOpenDocument?: (doc: DbDocument) => void; onContextMenu: (e: React.MouseEvent, state: ContextMenuState) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
    opacity: isDragging ? 0.25 : 1,
    touchAction: "none",
  };
  const isSpreadsheet = doc.type === "spreadsheet";
  const preview = getDocPreview(doc);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => onContextMenu(e, { x: e.clientX, y: e.clientY, type: "document", id: doc.id, doc })}
      className={`relative flex flex-col p-4 rounded-2xl ${bgCard} ${bgCardHover} border ${borderColor} hover:border-border/25 transition-[box-shadow,border-color] duration-200 hover:shadow-lg hover:shadow-black/5 group text-left cursor-grab active:cursor-grabbing`}
    >
      <div onClick={() => onOpenDocument?.(doc)} className="contents">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isSpreadsheet ? "bg-emerald-500/10" : "bg-blue-400/10"}`}>
            {isSpreadsheet ? <Table size={14} className="text-emerald-500" strokeWidth={1.5} /> : <FileText size={14} className="text-blue-400" strokeWidth={1.5} />}
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium uppercase tracking-wider ${isSpreadsheet ? "bg-emerald-500/8 text-emerald-500/70" : "bg-blue-400/8 text-blue-400/70"}`}>
            {isSpreadsheet ? "Sheet" : "Doc"}
          </span>
        </div>
        <p className={`text-xs font-semibold truncate mb-1.5 transition-colors ${lm ? "text-gray-800 group-hover:text-gray-900" : "text-foreground/90 group-hover:text-foreground"}`}>
          {highlightMatch(doc.title, searchQuery)}
        </p>
        <p className={`text-[10px] leading-relaxed line-clamp-2 mb-3 ${lm ? "text-gray-500" : "text-muted-foreground/50"}`}>{preview}</p>
        <div className="flex items-center gap-1 mt-auto">
          <Clock size={9} className={lm ? "text-gray-300" : "text-muted-foreground/30"} />
          <span className={`text-[9px] ${lm ? "text-gray-400" : "text-muted-foreground/40"}`}>{formatDate(doc.updated_at)}</span>
        </div>
      </div>
    </div>
  );
};

const SortableDocList = ({ doc, searchQuery, lm, textPrimary, textMuted, onOpenDocument, onContextMenu }: {
  doc: DbDocument; searchQuery: string; lm: boolean; textPrimary: string; textMuted: string;
  onOpenDocument?: (doc: DbDocument) => void; onContextMenu: (e: React.MouseEvent, state: ContextMenuState) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition || "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
    opacity: isDragging ? 0.25 : 1,
    touchAction: "none",
  };
  const isSpreadsheet = doc.type === "spreadsheet";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onContextMenu={(e) => onContextMenu(e, { x: e.clientX, y: e.clientY, type: "document", id: doc.id, doc })}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-[background-color] duration-200 text-left group cursor-grab active:cursor-grabbing ${lm ? "hover:bg-gray-100/80" : "hover:bg-secondary/40"}`}
    >
      <div onClick={() => onOpenDocument?.(doc)} className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSpreadsheet ? "bg-emerald-500/8" : "bg-blue-400/8"}`}>
          {isSpreadsheet ? <Table size={16} className="text-emerald-500" /> : <FileText size={16} className="text-blue-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <span className={`text-[13px] font-medium truncate block transition-colors ${lm ? "text-gray-800 group-hover:text-gray-900" : "text-foreground/90 group-hover:text-foreground"}`}>
            {highlightMatch(doc.title, searchQuery)}
          </span>
          <span className={`text-[10px] truncate block ${lm ? "text-gray-400" : "text-muted-foreground/40"}`}>{getDocPreview(doc)}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <GripVertical size={12} className={`opacity-0 group-hover:opacity-50 transition-opacity ${lm ? "text-gray-400" : "text-muted-foreground/40"}`} />
        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium uppercase tracking-wider ${isSpreadsheet ? "bg-emerald-500/8 text-emerald-500/60" : "bg-blue-400/8 text-blue-400/60"}`}>
          {isSpreadsheet ? "xlsx" : "doc"}
        </span>
        <span className={`text-[9px] ${lm ? "text-gray-400" : "text-muted-foreground/30"}`}>{formatDate(doc.updated_at)}</span>
      </div>
    </div>
  );
};

/* ─── Main Component ─── */
const FolderContents = ({
  subfolders, documents, loading, viewMode, searchQuery = "", lightMode = false, modalRef,
  onOpenSubfolder, onOpenDocument, onCreateFolder, onCreateDocument, onMoveFolder,
  onRenameFolder, onDeleteFolder, onDuplicateFolder, onDeleteDocument, onDuplicateDocument,
  onReorderDocuments, onDragOutDocument, onDragOutFolder,
  onAddToCalendar, onMoveDocToFolder, onShareDocument, allFolders, currentFolderId,
  onUpdateFolder,
}: FolderContentsProps) => {
  const isEmpty = subfolders.length === 0 && documents.length === 0;
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const draggedFolderId = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [orderedDocs, setOrderedDocs] = useState<DbDocument[]>(documents);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [calendarDoc, setCalendarDoc] = useState<DbDocument | null>(null);
  const [calendarDate, setCalendarDate] = useState<Date | undefined>(new Date());
  const [calendarTime, setCalendarTime] = useState("09:00");
  const [moveFolderDoc, setMoveFolderDoc] = useState<DbDocument | null>(null);
  const [showFolderDesign, setShowFolderDesign] = useState(false);
  const lastPointerPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => { setOrderedDocs(documents); }, [documents]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const lm = lightMode;
  const textPrimary = lm ? "text-gray-900" : "text-foreground";
  const textSecondary = lm ? "text-gray-600" : "text-muted-foreground";
  const textMuted = lm ? "text-gray-400" : "text-muted-foreground/50";
  const bgCard = lm ? "bg-white/80" : "bg-secondary/20";
  const bgCardHover = lm ? "hover:bg-white" : "hover:bg-secondary/40";
  const borderColor = lm ? "border-gray-200/60" : "border-border/10";
  const ctxBg = lm ? "bg-white/95" : "bg-card/95";
  const ctxBorder = lm ? "border-gray-200/60" : "border-border/40";
  const ctxHover = lm ? "hover:bg-gray-100" : "hover:bg-secondary/50";

  useEffect(() => {
    const close = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
      return () => { window.removeEventListener("click", close); window.removeEventListener("contextmenu", close); };
    }
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, state: ContextMenuState) => {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX, window.innerWidth - 208);
    const y = Math.min(e.clientY, window.innerHeight - 208);
    setContextMenu({ ...state, x, y });
  }, []);

  // Folder HTML5 drag handlers
  const handleFolderDragStart = (e: React.DragEvent, folderId: string) => {
    draggedFolderId.current = folderId;
    e.dataTransfer.setData("modal-folder-id", folderId);
    e.dataTransfer.effectAllowed = "move";
    (e.target as HTMLElement).style.opacity = "0.4";
  };
  const handleFolderDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = "1";
    draggedFolderId.current = null;
    setDragOverId(null);
  };
  const handleFolderDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedFolderId.current && draggedFolderId.current !== targetId) setDragOverId(targetId);
  };
  const handleFolderDragLeave = () => setDragOverId(null);
  const handleFolderDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    if (draggedFolderId.current && draggedFolderId.current !== targetId && onMoveFolder) {
      onMoveFolder(draggedFolderId.current, targetId);
    }
    draggedFolderId.current = null;
  };

  // dnd-kit document drag handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
    lastPointerPos.current = null;
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const ae = event.activatorEvent as PointerEvent;
    if (ae) {
      lastPointerPos.current = {
        x: ae.clientX + (event.delta?.x || 0),
        y: ae.clientY + (event.delta?.y || 0),
      };
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (modalRef?.current && lastPointerPos.current) {
      const rect = modalRef.current.getBoundingClientRect();
      const { x, y } = lastPointerPos.current;
      const margin = 8;
      if (x < rect.left - margin || x > rect.right + margin || y < rect.top - margin || y > rect.bottom + margin) {
        const doc = orderedDocs.find(d => d.id === active.id);
        if (doc && onDragOutDocument) {
          onDragOutDocument(doc);
          lastPointerPos.current = null;
          return;
        }
      }
    }
    lastPointerPos.current = null;

    if (over && active.id !== over.id) {
      setOrderedDocs((items) => {
        const oldIndex = items.findIndex(d => d.id === active.id);
        const newIndex = items.findIndex(d => d.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return items;
        const newOrder = arrayMove(items, oldIndex, newIndex);
        onReorderDocuments?.(newOrder);
        return newOrder;
      });
    }
  }, [modalRef, orderedDocs, onDragOutDocument, onReorderDocuments]);

  const activeDoc = activeDragId ? orderedDocs.find(d => d.id === activeDragId) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (isEmpty && !searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-5">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
          <Folder size={32} className="text-primary/40" strokeWidth={1.5} />
        </div>
        <div className="text-center">
          <p className={`text-sm font-medium mb-1 ${lm ? "text-gray-700" : "text-foreground/70"}`}>This folder is empty</p>
          <p className={`text-xs ${textMuted}`}>Create something to get started</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onCreateFolder} className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-all duration-200 hover:scale-[1.02]">
            <FolderPlus size={14} /> New Folder
          </button>
          <button onClick={() => onCreateDocument("text")} className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl ${lm ? "bg-gray-100 hover:bg-gray-200 text-gray-700" : "bg-secondary/60 hover:bg-secondary text-foreground"} transition-all duration-200 hover:scale-[1.02]`}>
            <FileText size={14} /> Document
          </button>
          <button onClick={() => onCreateDocument("spreadsheet")} className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl ${lm ? "bg-gray-100 hover:bg-gray-200 text-gray-700" : "bg-secondary/60 hover:bg-secondary text-foreground"} transition-all duration-200 hover:scale-[1.02]`}>
            <Table size={14} /> Spreadsheet
          </button>
        </div>
      </div>
    );
  }

  if (isEmpty && searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <div className="w-14 h-14 rounded-2xl bg-muted/15 flex items-center justify-center">
          <FileText size={24} className="text-muted-foreground/25" />
        </div>
        <p className={`text-sm ${textSecondary}`}>No results for "{searchQuery}"</p>
        <p className={`text-xs ${textMuted}`}>Try a different search term</p>
      </div>
    );
  }

  // ─── Subfolder renderers ───
  const renderSubfolderGrid = (sf: FolderNode, i: number) => {
    const customIcon = sf.icon ? FOLDER_ICONS.find((ic) => ic.name === sf.icon) : null;
    const IconComp = customIcon ? customIcon.icon : Folder;
    const isDropTarget = dragOverId === sf.id;
    const folderColor = sf.color || "hsl(var(--muted-foreground))";
    return (
      <motion.button
        key={sf.id}
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: i * 0.03, duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={() => onOpenSubfolder(sf.id)}
        onContextMenu={(e) => handleContextMenu(e, { x: e.clientX, y: e.clientY, type: "folder", id: sf.id, folder: sf })}
        draggable
        onDragStart={(e: any) => handleFolderDragStart(e, sf.id)}
        onDragEnd={(e: any) => handleFolderDragEnd(e)}
        onDragOver={(e: any) => handleFolderDragOver(e, sf.id)}
        onDragLeave={handleFolderDragLeave}
        onDrop={(e: any) => handleFolderDrop(e, sf.id)}
        className={`relative flex flex-col items-center gap-2.5 p-5 rounded-2xl transition-all duration-250 group ${
          isDropTarget
            ? "scale-[1.04] ring-2 ring-blue-400/50 bg-blue-500/8 shadow-[0_0_24px_rgba(59,130,246,0.2)]"
            : `${lm ? "hover:bg-gray-100/80" : "hover:bg-secondary/30"} hover:shadow-lg hover:shadow-black/5 hover:scale-[1.03]`
        }`}
      >
        <div
          className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-250 group-hover:scale-110 group-hover:shadow-md ${isDropTarget ? "scale-110" : ""}`}
          style={{
            background: `linear-gradient(135deg, ${folderColor}12, ${folderColor}08)`,
            boxShadow: isDropTarget ? `0 0 20px ${folderColor}20` : undefined,
          }}
        >
          {isDropTarget ? <FolderOpen size={26} style={{ color: folderColor }} strokeWidth={1.5} /> : <IconComp size={26} style={{ color: folderColor }} strokeWidth={1.5} />}
        </div>
        <span className={`text-[11px] font-medium text-center truncate w-full leading-tight ${lm ? "text-gray-800" : "text-foreground/90"}`}>
          {highlightMatch(sf.title, searchQuery)}
        </span>
        {sf.children.length > 0 && <span className={`text-[9px] ${textMuted}`}>{sf.children.length} items</span>}
      </motion.button>
    );
  };

  const renderSubfolderList = (sf: FolderNode, i: number) => {
    const customIcon = sf.icon ? FOLDER_ICONS.find((ic) => ic.name === sf.icon) : null;
    const IconComp = customIcon ? customIcon.icon : Folder;
    const isDropTarget = dragOverId === sf.id;
    const folderColor = sf.color || "hsl(var(--muted-foreground))";
    return (
      <motion.button
        key={sf.id}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.02, duration: 0.2 }}
        onClick={() => onOpenSubfolder(sf.id)}
        onContextMenu={(e) => handleContextMenu(e, { x: e.clientX, y: e.clientY, type: "folder", id: sf.id, folder: sf })}
        draggable
        onDragStart={(e: any) => handleFolderDragStart(e, sf.id)}
        onDragEnd={(e: any) => handleFolderDragEnd(e)}
        onDragOver={(e: any) => handleFolderDragOver(e, sf.id)}
        onDragLeave={handleFolderDragLeave}
        onDrop={(e: any) => handleFolderDrop(e, sf.id)}
        className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all duration-200 text-left group ${
          isDropTarget
            ? "scale-[1.01] ring-2 ring-blue-400/50 bg-blue-500/8 shadow-[0_0_16px_rgba(59,130,246,0.15)]"
            : `${lm ? "hover:bg-gray-100/80" : "hover:bg-secondary/40"}`
        }`}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${folderColor}10` }}>
          {isDropTarget ? <FolderOpen size={16} style={{ color: folderColor }} /> : <IconComp size={16} style={{ color: folderColor }} />}
        </div>
        <span className={`text-[13px] font-medium flex-1 truncate transition-colors ${lm ? "text-gray-800 group-hover:text-gray-900" : "text-foreground/90 group-hover:text-foreground"}`}>
          {highlightMatch(sf.title, searchQuery)}
        </span>
        {sf.children.length > 0 && <span className={`text-[10px] ${lm ? "text-gray-400" : "text-muted-foreground/40"}`}>{sf.children.length}</span>}
      </motion.button>
    );
  };

  /* ─── Context Menu ─── */

  const SUBFOLDER_COLORS = [
    { name: "Default", value: "" },
    { name: "Blue", value: "hsl(210 90% 55%)" },
    { name: "Violet", value: "hsl(265 80% 58%)" },
    { name: "Pink", value: "hsl(330 75% 55%)" },
    { name: "Green", value: "hsl(150 60% 45%)" },
    { name: "Orange", value: "hsl(30 90% 55%)" },
    { name: "Teal", value: "hsl(175 60% 42%)" },
    { name: "Red", value: "hsl(0 72% 55%)" },
    { name: "Amber", value: "hsl(45 93% 50%)" },
  ];

  const renderContextMenu = () => {
    if (!contextMenu) return null;
    const isFolder = contextMenu.type === "folder";
    return createPortal(
      <div
        className={`fixed z-[9999] min-w-[180px] py-1.5 rounded-xl ${ctxBg} backdrop-blur-xl border ${ctxBorder} shadow-2xl shadow-black/30 animate-scale-in`}
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => { if (isFolder) onOpenSubfolder(contextMenu.id); else if (contextMenu.doc) onOpenDocument?.(contextMenu.doc); setContextMenu(null); }}
          className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}
        >
          <ExternalLink size={13} className={textSecondary} /> Open
        </button>
        {isFolder && onRenameFolder && (
          <button onClick={() => { onRenameFolder(contextMenu.id); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <Pencil size={13} className={textSecondary} /> Rename
          </button>
        )}
        {isFolder && onDuplicateFolder && (
          <button onClick={() => { onDuplicateFolder(contextMenu.id); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <Copy size={13} className={textSecondary} /> Duplicate
          </button>
        )}
        {isFolder && onUpdateFolder && contextMenu.folder && (
          <>
            <button onClick={() => setShowFolderDesign(!showFolderDesign)} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
              <Palette size={13} className={textSecondary} /> Change Design
            </button>
            {showFolderDesign && (
              <div className="px-3 py-2 space-y-2">
                <p className={`text-[9px] uppercase tracking-wider font-medium ${lm ? "text-gray-400" : "text-muted-foreground/50"}`}>Color</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUBFOLDER_COLORS.map(c => (
                    <button
                      key={c.name}
                      onClick={() => { onUpdateFolder(contextMenu.id, { color: c.value || undefined }); }}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-125 ${
                        (contextMenu.folder?.color || "") === c.value ? "border-foreground scale-110" : "border-transparent"
                      }`}
                      style={{ background: c.value || (lm ? "#9ca3af" : "#6b7280") }}
                      title={c.name}
                    />
                  ))}
                </div>
                <p className={`text-[9px] uppercase tracking-wider font-medium mt-2 ${lm ? "text-gray-400" : "text-muted-foreground/50"}`}>Icon</p>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {FOLDER_ICONS.slice(0, 20).map(ic => {
                    const Icon = ic.icon;
                    const isActive = contextMenu.folder?.icon === ic.name;
                    return (
                      <button
                        key={ic.name}
                        onClick={() => { onUpdateFolder(contextMenu.id, { icon: ic.name }); }}
                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
                          isActive
                            ? (lm ? "bg-primary/15 text-primary" : "bg-white/15 text-foreground")
                            : (lm ? "hover:bg-gray-100 text-gray-500" : "hover:bg-white/10 text-muted-foreground/60")
                        }`}
                        title={ic.name}
                      >
                        <Icon size={12} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
        {!isFolder && contextMenu.doc && onDuplicateDocument && (
          <button onClick={() => { onDuplicateDocument(contextMenu.doc!); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <Copy size={13} className={textSecondary} /> Duplicate
          </button>
        )}
        {!isFolder && contextMenu.doc && onAddToCalendar && (
          <button onClick={() => { setCalendarDoc(contextMenu.doc!); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <CalendarPlus size={13} className={textSecondary} /> Add to Calendar
          </button>
        )}
        {!isFolder && contextMenu.doc && onMoveDocToFolder && allFolders && allFolders.length > 0 && (
          <button onClick={() => { setMoveFolderDoc(contextMenu.doc!); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <FolderInput size={13} className={textSecondary} /> Move to Folder
          </button>
        )}
        {!isFolder && contextMenu.doc && onShareDocument && (
          <button onClick={() => { onShareDocument(contextMenu.doc!); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] ${textPrimary} ${ctxHover} transition-colors`}>
            <Share2 size={13} className={textSecondary} /> Share
          </button>
        )}
        <div className={`h-px ${lm ? "bg-gray-200" : "bg-border/20"} mx-2.5 my-1`} />
        {isFolder && onDeleteFolder && (
          <button onClick={() => { onDeleteFolder(contextMenu.id); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-destructive ${lm ? "hover:bg-red-50" : "hover:bg-destructive/10"} transition-colors`}>
            <Trash2 size={13} /> Delete
          </button>
        )}
        {!isFolder && onDeleteDocument && (
          <button onClick={() => { onDeleteDocument(contextMenu.id); setContextMenu(null); }} className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-destructive ${lm ? "hover:bg-red-50" : "hover:bg-destructive/10"} transition-colors`}>
            <Trash2 size={13} /> Delete
          </button>
        )}
      </div>,
      document.body
    );
  };

  /* ─── Calendar picker popover for Add to Calendar ─── */
  const renderCalendarPicker = () => {
    if (!calendarDoc) return null;
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setCalendarDoc(null)} />
        <div className={`fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-4 rounded-xl ${ctxBg} backdrop-blur-xl border ${ctxBorder} shadow-2xl`}>
          <p className={`text-xs font-medium mb-2 ${textPrimary}`}>Schedule "{calendarDoc.title}"</p>
          <Calendar mode="single" selected={calendarDate} onSelect={setCalendarDate} className="rounded-lg" />
          <div className="flex items-center gap-2 mt-2">
            <Clock size={12} className={textSecondary} />
            <input type="time" value={calendarTime} onChange={(e) => setCalendarTime(e.target.value)} className={`text-xs px-2 py-1 rounded-lg border ${lm ? "bg-white border-gray-200" : "bg-secondary/40 border-border/30"} ${textPrimary}`} />
          </div>
          <button
            onClick={() => {
              if (calendarDate && calendarDoc) {
                onAddToCalendar?.(calendarDoc, calendarDate, calendarTime);
                setCalendarDoc(null);
              }
            }}
            className="w-full mt-3 py-1.5 text-xs font-medium rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
          >
            Add to Calendar
          </button>
        </div>
      </>,
      document.body
    );
  };

  /* ─── Move to folder picker ─── */
  const renderMoveFolderPicker = () => {
    if (!moveFolderDoc || !allFolders) return null;
    const availableFolders = allFolders.filter(f => f.id !== currentFolderId);
    return createPortal(
      <>
        <div className="fixed inset-0 z-[9998]" onClick={() => setMoveFolderDoc(null)} />
        <div className={`fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 p-4 rounded-xl ${ctxBg} backdrop-blur-xl border ${ctxBorder} shadow-2xl min-w-[200px] max-h-[300px] overflow-y-auto`}>
          <p className={`text-xs font-medium mb-2 ${textPrimary}`}>Move "{moveFolderDoc.title}" to:</p>
          {availableFolders.length === 0 && <p className={`text-xs ${textMuted}`}>No other folders</p>}
          {availableFolders.map(f => (
            <button
              key={f.id}
              onClick={() => {
                onMoveDocToFolder?.(moveFolderDoc, f.id);
                setMoveFolderDoc(null);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg ${ctxHover} ${textPrimary} transition-colors`}
            >
              <Folder size={13} style={{ color: f.color || undefined }} /> {f.title}
            </button>
          ))}
          <div className={`h-px ${lm ? "bg-gray-200" : "bg-border/20"} my-1`} />
          <button
            onClick={() => {
              onMoveDocToFolder?.(moveFolderDoc, "desktop");
              setMoveFolderDoc(null);
            }}
            className={`w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg ${ctxHover} ${textPrimary} transition-colors`}
          >
            <ExternalLink size={13} className={textSecondary} /> Move to Desktop
          </button>
        </div>
      </>,
      document.body
    );
  };

  const docIds = orderedDocs.map(d => d.id);

  if (viewMode === "list") {
    return (
      <>
        <div className="space-y-0.5">
          {subfolders.map((sf, i) => renderSubfolderList(sf, i))}
          {subfolders.length > 0 && orderedDocs.length > 0 && (
            <div className={`h-px ${lm ? "bg-gray-200/60" : "bg-border/10"} mx-3 my-2`} />
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
            <SortableContext items={docIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5">
                {orderedDocs.map((doc) => (
                  <SortableDocList key={doc.id} doc={doc} searchQuery={searchQuery} lm={lm} textPrimary={textPrimary} textMuted={textMuted} onOpenDocument={onOpenDocument} onContextMenu={handleContextMenu} />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
              {activeDoc ? <DocListOverlay doc={activeDoc} lm={lm} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
        {renderContextMenu()}
        {renderCalendarPicker()}
        {renderMoveFolderPicker()}
      </>
    );
  }

  return (
    <>
      <div>
        {subfolders.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2 mb-4">
            {subfolders.map((sf, i) => renderSubfolderGrid(sf, i))}
          </div>
        )}
        {subfolders.length > 0 && orderedDocs.length > 0 && (
          <div className={`h-px ${lm ? "bg-gray-200/60" : "bg-border/10"} mx-2 mb-4`} />
        )}
        {orderedDocs.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
            <SortableContext items={docIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {orderedDocs.map((doc) => (
                  <SortableDocGrid key={doc.id} doc={doc} searchQuery={searchQuery} lm={lm} bgCard={bgCard} bgCardHover={bgCardHover} borderColor={borderColor} onOpenDocument={onOpenDocument} onContextMenu={handleContextMenu} />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
              {activeDoc ? <DocGridOverlay doc={activeDoc} lm={lm} bgCard={bgCard} borderColor={borderColor} /> : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
      {renderContextMenu()}
      {renderCalendarPicker()}
      {renderMoveFolderPicker()}
    </>
  );
};

export default FolderContents;
