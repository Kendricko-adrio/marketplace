"use client";

import { Plus, Trash2 } from "lucide-react";

import { canonicalizePromoCode } from "@marketplace/db/src/discount-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CodeProposal, CodeStateTarget, DiscountEditorState } from "./discount-editor-state";

const CODE_STATE_LABEL: Record<CodeStateTarget["state"], string> = {
  active: "Aktif",
  inactive: "Nonaktif",
  archived: "Diarsipkan",
};

/**
 * Tab **Kode** hanya untuk kode promo (`manual_only`). Penambahan kode dan
 * perubahan status adalah bagian draft: belum direservasi/berlaku sebelum
 * publish, dan literal existing tidak dapat diubah atau dipindah pemiliknya.
 */
export function DiscountCodesSection(props: {
  state: DiscountEditorState;
  disabled: boolean;
  onAdd: (raw: string) => void;
  onRemove: (key: string) => void;
  onNewCodeChange: (value: string) => void;
  onStateChange: (codeId: string, state: CodeStateTarget["state"]) => void;
}) {
  const { state, disabled, onAdd, onRemove, onNewCodeChange, onStateChange } = props;
  const draftCode = props.state.newCode;
  const canSeeLiterals = state.detail.codeLiteralVisible;
  const proposalError =
    state.fieldErrors["codeChanges.proposedCodes"] ??
    Object.entries(state.fieldErrors).find(([path]) =>
      path.startsWith("codeChanges.proposedCodes.")
    )?.[1] ??
    null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Kode promo</h2>
        </CardTitle>
        <CardDescription>
          Semua kode berbagi kuota, budget, dan batas per customer promo ini.
          Kode baru dan status target berlaku setelah publish.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <section className="space-y-4">
          <h3 className="text-sm font-semibold">Kode baru</h3>
          {!canSeeLiterals ? (
            <p className="text-sm text-muted-foreground">
              Anda hanya dapat melihat label kode yang disamarkan. Penambahan kode
              memerlukan izin edit promo.
            </p>
          ) : (
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const raw = draftCode.trim();
                if (raw.length < 3) return;
                onAdd(raw);
                onNewCodeChange("");
              }}
            >
              <div className="w-full max-w-xs space-y-2">
                <Label htmlFor="new-code">Tambah kode</Label>
                <Input
                  id="new-code"
                  value={draftCode}
                  disabled={disabled}
                  onChange={(event) => onNewCodeChange(event.target.value)}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="HEMAT17AGUSTUS"
                  className="font-mono uppercase"
                  aria-describedby="new-code-hint"
                  aria-invalid={proposalError ? true : undefined}
                />
                <p id="new-code-hint" className="text-xs text-muted-foreground">
                  Kode disimpan di draft dulu; belum aktif dan belum direservasi
                  sebelum publish.
                </p>
              </div>
              <Button type="submit" className="mt-7" disabled={disabled || draftCode.trim().length < 3}>
                <Plus className="mr-2 h-4 w-4" />
                Tambah ke draft
              </Button>
            </form>
          )}
          {proposalError ? <p className="text-xs text-destructive">{proposalError}</p> : null}

          {state.codeProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada kode baru pada draft.</p>
          ) : (
            <ul className="space-y-2">
              {state.codeProposals.map((proposal: CodeProposal) => (
                <li
                  key={proposal.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <span className="font-mono text-sm uppercase">{canonicalizePromoCode(proposal.raw) ?? proposal.raw}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onRemove(proposal.key)}
                    aria-label={`Hapus usulan kode ${proposal.raw}`}
                  >
                    <Trash2 className="h-4 w-4" />
                    Hapus
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 border-t pt-6">
          <h3 className="text-sm font-semibold">Kode yang sudah diterbitkan</h3>
          {state.detail.codes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada kode.</p>
          ) : (
            <div className="max-w-full overflow-x-auto rounded-md border">
              <Table aria-label="Kode yang sudah diterbitkan">
                <TableHeader>
                  <TableRow>
                    <TableHead>Kode</TableHead>
                    <TableHead>Status berlaku</TableHead>
                    <TableHead>Status setelah publish</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.detail.codes.map((code) => {
                    const target = state.codeStates[code.id];
                    return (
                      <TableRow key={code.id}>
                        <TableCell className="font-mono text-xs">
                          {canSeeLiterals && code.code ? code.code : code.maskedCode}
                        </TableCell>
                        <TableCell>
                          <Badge variant={code.state === "active" ? "default" : "secondary"}>
                            {CODE_STATE_LABEL[code.state as CodeStateTarget["state"]] ?? code.state}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={target?.state ?? code.state}
                            disabled={disabled || code.state === "archived"}
                            onValueChange={(value) =>
                              onStateChange(code.id, value as CodeStateTarget["state"])
                            }
                          >
                            <SelectTrigger
                              className="w-40"
                              aria-label={`Status setelah publish untuk kode ${code.maskedCode}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Aktif</SelectItem>
                              <SelectItem value="inactive">Nonaktif</SelectItem>
                              <SelectItem value="archived">Diarsipkan</SelectItem>
                            </SelectContent>
                          </Select>
                          {code.state === "archived" ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Kode diarsipkan tidak dapat diaktifkan kembali.
                            </p>
                          ) : target && target.state !== code.state ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              Belum berlaku; menunggu publish.
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Kode lama tidak dapat diubah literalnya atau dipindahkan ke promo lain.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
