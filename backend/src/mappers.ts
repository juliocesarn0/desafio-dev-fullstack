import { Enquadramento, ModeloFasico } from "@prisma/client";

type Consumo = { consumoForaPontaEmKWH: number; mesDoConsumo: Date };
export type UnidadeDecoded = {
  codigoDaUnidadeConsumidora: string;
  modeloFasico: ModeloFasico;
  enquadramento: Enquadramento;
  historicoDeConsumoEmKWH: Consumo[];
};

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeModeloFasico(v: unknown): ModeloFasico {
  const raw = stripAccents(String(v ?? "")).toLowerCase();
  if (raw.includes("mono") || raw === "monofasico") return "monofasico";
  if (raw.includes("bi") || raw === "bifasico") return "bifasico";
  if (raw.includes("tri") || raw === "trifasico") return "trifasico";
  throw new Error(`modeloFasico inválido: ${String(v)}`);
}

function normalizeEnquadramento(v: unknown): Enquadramento {
  const raw = String(v ?? "").toUpperCase();
  const m = raw.match(/\b(AX|B1|B2|B3)\b/);
  if (!m) throw new Error(`enquadramento inválido: ${String(v)}`);
  return m[1] as Enquadramento;
}

function toDate(v: unknown): Date {
  const d = new Date(String(v ?? ""));
  if (Number.isNaN(d.getTime())) throw new Error(`Data inválida: ${String(v)}`);
  return d;
}

function extractUnits(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.units)) return payload.units;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.payload)) return payload.payload;
  return [payload];
}

export function mapMagicPdfToUnidades(payload: unknown): UnidadeDecoded[] {
  const units = extractUnits(payload as any);

  const mapped: UnidadeDecoded[] = [];

  for (const u of units) {
    const codigo =
      u?.unit_key ??
      u?.unitKey ??
      u?.codigoDaUnidadeConsumidora ??
      u?.codigo_unidade ??
      u?.codigo_uc ??
      u?.codigo ??
      u?.uc;

    if (!codigo)
      throw new Error("Não achei codigoDaUnidadeConsumidora (unit_key)");

    const modelo = normalizeModeloFasico(u?.phaseModel ?? u?.modeloFasico);
    const enqua = normalizeEnquadramento(u?.chargingModel ?? u?.enquadramento);

    const rawHist =
      u?.invoice ??
      u?.invoices ??
      u?.historicoDeConsumoEmKWH ??
      u?.consumos ??
      u?.consumptionHistory ??
      u?.history ??
      u?.historico ??
      u?.consumo ??
      [];

    if (!Array.isArray(rawHist))
      throw new Error("Histórico de consumo não é array");

    const historico = rawHist.map((c: any) => ({
      consumoForaPontaEmKWH: Number(
        c?.consumo_fp ?? c?.consumoForaPontaEmKWH ?? c?.kwh ?? 0,
      ),
      mesDoConsumo: toDate(c?.consumo_date ?? c?.mesDoConsumo ?? c?.date),
    }));

    // Ordena por data e pega os últimos 12 (regra do desafio)
    historico.sort(
      (a, b) => a.mesDoConsumo.getTime() - b.mesDoConsumo.getTime(),
    );
    const last12 = historico.slice(-12);

    if (last12.length !== 12) {
      throw new Error(
        `Unidade ${String(codigo)} com histórico inválido: ${last12.length}/12 meses`,
      );
    }

    mapped.push({
      codigoDaUnidadeConsumidora: String(codigo),
      modeloFasico: modelo,
      enquadramento: enqua,
      historicoDeConsumoEmKWH: last12,
    });
  }

  return mapped;
}
