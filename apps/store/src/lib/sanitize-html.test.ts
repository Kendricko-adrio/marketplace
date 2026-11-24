import { describe, expect, it } from "vitest";
import { sanitizeProductHtml } from "@marketplace/ui";

describe("sanitizeProductHtml", () => {
  it("mengembalikan string kosong untuk input kosong, null, atau undefined", () => {
    expect(sanitizeProductHtml("")).toBe("");
    expect(sanitizeProductHtml(null)).toBe("");
    expect(sanitizeProductHtml(undefined)).toBe("");
  });

  it("mempertahankan tag formatting aman dan daftar dari deskripsi Jubelio", () => {
    const html =
      "<p>Sepatu <strong>ringan</strong> untuk <em>lari</em> harian.</p>" +
      "<ul><li>Sol empuk</li><li>Upper breathable</li></ul>" +
      "<br /><table><thead><tr><th>Ukuran</th></tr></thead><tbody><tr><td>42</td></tr></tbody></table>";

    const result = sanitizeProductHtml(html);

    expect(result).toContain("<p>Sepatu <strong>ringan</strong> untuk <em>lari</em> harian.</p>");
    expect(result).toContain("<ul><li>Sol empuk</li><li>Upper breathable</li></ul>");
    expect(result).toContain("<br />");
    expect(result).toContain("<table><thead><tr><th>Ukuran</th></tr></thead><tbody><tr><td>42</td></tr></tbody></table>");
  });

  it("menghapus tag berbahaya seperti script, iframe, style, object, embed, dan form", () => {
    const dirty =
      '<p>Aman</p><script>alert("xss")</script>' +
      '<iframe src="https://evil.example"></iframe>' +
      "<style>body { display: none }</style>" +
      '<object data="x"></object><embed src="x" />' +
      '<form action="/steal"><input name="token" /></form>';

    const result = sanitizeProductHtml(dirty);

    expect(result).toBe("<p>Aman</p>");
  });

  it("menghapus atribut event handler inline (onerror, onclick) dan atribut style", () => {
    const dirty =
      '<p onclick="alert(1)" style="color:red">Halo</p>' +
      '<img src="https://cdn.jubelio.com/img.jpg" alt="Produk" onerror="alert(2)" onload="alert(3)" width="400" height="300" />';

    const result = sanitizeProductHtml(dirty);

    expect(result).toContain("<p>Halo</p>");
    expect(result).toContain('src="https://cdn.jubelio.com/img.jpg"');
    expect(result).toContain('alt="Produk"');
    expect(result).toContain('width="400"');
    expect(result).toContain('height="300"');
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("onload");
    expect(result).not.toContain("style=");
  });

  it("memblokir skema javascript: pada link dan skema data:/javascript: pada img", () => {
    const dirty =
      '<a href="javascript:alert(1)">Klik</a>' +
      '<img src="data:image/svg+xml,<svg onload=alert(1)>" alt="svg" />' +
      '<img src="javascript:alert(1)" alt="js" />';

    const result = sanitizeProductHtml(dirty);

    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("data:");
  });

  it("mempertahankan link aman dan memaksa rel=noopener noreferrer saat target=_blank", () => {
    const html =
      '<a href="https://adfsports.id/panduan" target="_blank">Panduan</a> ' +
      '<a href="mailto:cs@adfsports.id">Email</a>';

    const result = sanitizeProductHtml(html);

    expect(result).toContain('href="https://adfsports.id/panduan"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('href="mailto:cs@adfsports.id"');
  });
});
