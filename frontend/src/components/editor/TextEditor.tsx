import { useState, useRef, useEffect } from "react";

interface TextEditorProps {
  position: { x: number; y: number };
  zoom: number;
  initialText?: string;
  isEditing?: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function TextEditor({
  position,
  zoom,
  initialText = "",
  isEditing = false,
  onSubmit,
  onCancel,
}: TextEditorProps) {
  const [text, setText] = useState(initialText);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      // Delay focus until after the pointer event that created this component
      // has fully resolved — prevents the browser from stealing focus back,
      // which would trigger an immediate blur and dismiss the editor.
      requestAnimationFrame(() => {
        el.focus();
        if (isEditing) {
          el.select();
        }
        readyRef.current = true;
      });
    }
    return () => { readyRef.current = false; };
  }, [isEditing]);

  const handleSubmit = () => {
    if (text.trim()) {
      onSubmit(text.trim());
    } else {
      onCancel();
    }
  };

  const handleBlur = () => {
    if (!readyRef.current) return;
    handleSubmit();
  };

  return (
    <div
      className="absolute z-30"
      style={{
        left: position.x * zoom,
        top: position.y * zoom,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="relative">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={`min-w-[120px] min-h-[24px] max-w-[300px] resize-both overflow-hidden border-2 rounded px-1.5 py-0.5 text-sm outline-none shadow-lg ${
            isEditing
              ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
              : "border-green-500 bg-white dark:bg-slate-800"
          } dark:text-white`}
          placeholder="Type here..."
          rows={1}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") {
              onCancel();
            }
          }}
          onBlur={handleBlur}
        />
        <div className="mt-0.5 text-[10px] text-slate-400 whitespace-nowrap">
          {isEditing ? "Editing" : "Enter"} to confirm · Esc to cancel
        </div>
      </div>
    </div>
  );
}
