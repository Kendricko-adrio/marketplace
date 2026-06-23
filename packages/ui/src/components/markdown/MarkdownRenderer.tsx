"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: (props) => (
            <h1
              className="text-3xl font-bold tracking-tight mt-8 mb-4"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="text-2xl font-semibold tracking-tight mt-6 mb-3 border-b pb-1"
              {...props}
            />
          ),
          h3: (props) => (
            <h3 className="text-xl font-semibold mt-5 mb-2" {...props} />
          ),
          h4: (props) => (
            <h4 className="text-lg font-semibold mt-4 mb-2" {...props} />
          ),
          h5: (props) => (
            <h5 className="text-base font-semibold mt-3 mb-1" {...props} />
          ),
          h6: (props) => (
            <h6 className="text-sm font-semibold mt-3 mb-1" {...props} />
          ),
          p: (props) => (
            <p
              className="leading-relaxed text-muted-foreground mb-4"
              {...props}
            />
          ),
          a: (props) => (
            <a
              className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          ul: (props) => (
            <ul
              className="list-disc pl-6 mb-4 space-y-1 text-muted-foreground"
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              className="list-decimal pl-6 mb-4 space-y-1 text-muted-foreground"
              {...props}
            />
          ),
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="border-l-4 border-primary/40 pl-4 italic text-muted-foreground mb-4"
              {...props}
            />
          ),
          hr: (props) => <hr className="my-6 border-border" {...props} />,
          code: (props) => {
            const { className: codeClassName, children } = props;
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={codeClassName} {...props}>
                {children}
              </code>
            );
          },
          pre: (props) => (
            <pre
              className="rounded-md bg-slate-900 text-slate-50 p-4 overflow-x-auto mb-4 text-sm"
              {...props}
            />
          ),
          table: (props) => (
            <div className="overflow-x-auto mb-4">
              <table
                className="w-full border-collapse text-sm text-left"
                {...props}
              />
            </div>
          ),
          thead: (props) => <thead className="bg-muted/50" {...props} />,
          th: (props) => (
            <th
              className="border border-border px-3 py-2 font-semibold text-foreground"
              {...props}
            />
          ),
          td: (props) => (
            <td
              className="border border-border px-3 py-2 text-muted-foreground"
              {...props}
            />
          ),
          tr: (props) => <tr className="even:bg-muted/20" {...props} />,
          strong: (props) => (
            <strong className="font-semibold text-foreground" {...props} />
          ),
          em: (props) => <em className="italic" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}