import sanitizeHtml, { type IOptions } from "sanitize-html";

const PRODUCT_HTML_SANITIZE_OPTIONS: IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "hr",
    "span",
    "div",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "a",
    "img",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    a: ["http", "https", "mailto"],
    img: ["http", "https"],
  },
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => {
      if (attribs.target === "_blank") {
        return {
          tagName,
          attribs: {
            ...attribs,
            rel: "noopener noreferrer",
          },
        };
      }
      return { tagName, attribs };
    },
  },
};

/**
 * Sanitasi HTML deskripsi produk (mis. dari Jubelio) memakai allowlist aman
 * agar formatting dasar dan gambar http/https tetap tampil tanpa risiko XSS.
 */
export function sanitizeProductHtml(
  rawHtml: string | null | undefined
): string {
  if (!rawHtml) return "";
  return sanitizeHtml(rawHtml, PRODUCT_HTML_SANITIZE_OPTIONS);
}
