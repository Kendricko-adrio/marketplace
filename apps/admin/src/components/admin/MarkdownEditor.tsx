"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import { useCallback, useEffect } from "react";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Code,
  Strikethrough,
  Undo2,
  Redo2,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}

function ToolbarButton({
  onClick,
  isActive,
  disabled,
  children,
  title,
}: ToolbarButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("h-8 w-8 p-0", isActive && "bg-muted text-foreground")}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {children}
    </Button>
  );
}

export function MarkdownEditor({
  value,
  onChange,
  className,
}: MarkdownEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-primary underline underline-offset-2",
        },
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: {
          class:
            "w-full border-collapse text-sm text-left my-4",
        },
      }),
      TableRow.configure({
        HTMLAttributes: { class: "even:bg-muted/20" },
      }),
      TableHeader.configure({
        HTMLAttributes: {
          class:
            "border border-border px-3 py-2 font-semibold text-foreground bg-muted/50",
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: "border border-border px-3 py-2 text-muted-foreground",
        },
      }),
      Markdown.configure({
        html: false,
        breaks: false,
        linkify: true,
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class:
          "prose-editor min-h-[480px] max-w-none px-4 py-3 focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      const md = (
        editor.storage as unknown as { markdown: MarkdownStorage }
      ).markdown.getMarkdown();
      onChange(md);
    },
  });

  // Sync external value into the editor when it changes from the outside
  // (e.g. initial load). Avoids clobbering the cursor on every keystroke by
  // only setting when the serialized markdown differs.
  useEffect(() => {
    if (!editor) return;
    const current = (
      editor.storage as unknown as { markdown: MarkdownStorage }
    ).markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value || "");
    }
  }, [value, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL untuk tautan:", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) {
    return (
      <div className={cn("border rounded-md p-4 min-h-[480px]", className)}>
        <p className="text-muted-foreground text-sm">Memuat editor...</p>
      </div>
    );
  }

  return (
    <div className={cn("border rounded-md overflow-hidden", className)}>
      <div className="border-b bg-muted/30 p-1 flex flex-wrap items-center gap-0.5 sticky top-0 z-10">
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Batal (Undo)"
        >
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Ulangi (Redo)"
        >
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>

        <span className="w-px h-6 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          isActive={editor.isActive("heading", { level: 1 })}
          title="Judul 1"
        >
          <Heading1 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          isActive={editor.isActive("heading", { level: 2 })}
          title="Judul 2"
        >
          <Heading2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          isActive={editor.isActive("heading", { level: 3 })}
          title="Judul 3"
        >
          <Heading3 className="h-4 w-4" />
        </ToolbarButton>

        <span className="w-px h-6 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title="Tebal (Bold)"
        >
          <Bold className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title="Miring (Italic)"
        >
          <Italic className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title="Coret (Strikethrough)"
        >
          <Strikethrough className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          title="Kode (Inline Code)"
        >
          <Code className="h-4 w-4" />
        </ToolbarButton>

        <span className="w-px h-6 bg-border mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title="Daftar Bullet"
        >
          <List className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title="Daftar Bernomor"
        >
          <ListOrdered className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title="Kutipan (Quote)"
        >
          <Quote className="h-4 w-4" />
        </ToolbarButton>

        <span className="w-px h-6 bg-border mx-1" />

        <ToolbarButton
          onClick={setLink}
          isActive={editor.isActive("link")}
          title="Tautan (Link)"
        >
          <LinkIcon className="h-4 w-4" />
        </ToolbarButton>

        <span className="w-px h-6 bg-border mx-1" />

        <ToolbarButton
          onClick={() =>
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
              .run()
          }
          isActive={editor.isActive("table")}
          title="Sisipkan Tabel"
        >
          <TableIcon className="h-4 w-4" />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />

      <style jsx global>{`
        .prose-editor {
          color: hsl(var(--foreground));
          font-size: 0.875rem;
          line-height: 1.7;
        }
        .prose-editor:focus {
          outline: none;
        }
        .prose-editor h1 {
          font-size: 1.875rem;
          font-weight: 700;
          letter-spacing: -0.025em;
          margin: 2rem 0 1rem;
          line-height: 1.2;
        }
        .prose-editor h2 {
          font-size: 1.5rem;
          font-weight: 600;
          letter-spacing: -0.025em;
          margin: 1.5rem 0 0.75rem;
          padding-bottom: 0.25rem;
          border-bottom: 1px solid hsl(var(--border));
          line-height: 1.3;
        }
        .prose-editor h3 {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 1.25rem 0 0.5rem;
          line-height: 1.4;
        }
        .prose-editor p {
          margin: 0 0 1rem;
          color: hsl(var(--muted-foreground));
        }
        .prose-editor ul,
        .prose-editor ol {
          margin: 0 0 1rem;
          padding-left: 1.5rem;
          color: hsl(var(--muted-foreground));
        }
        .prose-editor ul {
          list-style-type: disc;
        }
        .prose-editor ol {
          list-style-type: decimal;
        }
        .prose-editor li {
          margin: 0.25rem 0;
        }
        .prose-editor blockquote {
          border-left: 4px solid hsl(var(--primary) / 0.4);
          padding-left: 1rem;
          font-style: italic;
          color: hsl(var(--muted-foreground));
          margin: 0 0 1rem;
        }
        .prose-editor hr {
          margin: 1.5rem 0;
          border-color: hsl(var(--border));
        }
        .prose-editor code {
          background: hsl(var(--muted));
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-size: 0.875em;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .prose-editor pre {
          background: #0f172a;
          color: #f1f5f9;
          padding: 1rem;
          border-radius: 0.375rem;
          overflow-x: auto;
          margin: 0 0 1rem;
          font-size: 0.875rem;
        }
        .prose-editor pre code {
          background: transparent;
          padding: 0;
          color: inherit;
        }
        .prose-editor a {
          color: hsl(var(--primary));
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .prose-editor strong {
          font-weight: 600;
          color: hsl(var(--foreground));
        }
        .prose-editor em {
          font-style: italic;
        }
        .prose-editor table {
          width: 100%;
          border-collapse: collapse;
          margin: 0 0 1rem;
          font-size: 0.875rem;
        }
        .prose-editor th,
        .prose-editor td {
          border: 1px solid hsl(var(--border));
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .prose-editor th {
          background: hsl(var(--muted) / 0.5);
          font-weight: 600;
          color: hsl(var(--foreground));
        }
        .prose-editor td {
          color: hsl(var(--muted-foreground));
        }
        .prose-editor p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground) / 0.6);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}