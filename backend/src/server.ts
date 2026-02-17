import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { z } from "zod";
import { prisma } from "./prisma";
import { decodeContaDeEnergia } from "./magicPdf";
import { mapMagicPdfToUnidades } from "./mappers";

const app = express();

app.use(express.json());

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
  }),
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

const createSchema = z.object({
  nomeCompleto: z.string().min(3),
  email: z.string().email(),
  telefone: z.string().min(8),
});

// --------------------
// POST /simulacoes
// multipart/form-data: nomeCompleto, email, telefone, file(s)
// --------------------
app.post(
  "/simulacoes",
  upload.fields([
    { name: "file", maxCount: 20 },
    { name: "files", maxCount: 20 },
  ]),
  async (req, res) => {
    try {
      const body = createSchema.parse(req.body);

      const filesObj = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;
      const files = [...(filesObj?.file ?? []), ...(filesObj?.files ?? [])];

      if (!files.length) {
        return res.status(400).json({
          message: "Envie pelo menos 1 conta de energia (file/files).",
        });
      }

      // regra: email único
      const existing = await prisma.lead.findUnique({
        where: { email: body.email },
      });
      if (existing) {
        return res
          .status(409)
          .json({ message: "Já existe um lead com esse e-mail." });
      }

      // decodifica cada arquivo na API interna
      const decodedPayloads = await Promise.all(
        files.map((f) =>
          decodeContaDeEnergia({
            buffer: f.buffer,
            filename: f.originalname,
            mimetype: f.mimetype,
          }),
        ),
      );

      console.log(
        "DEBUG invoice length:",
        (decodedPayloads[0] as any)?.invoice?.length,
        "keys:",
        Object.keys(decodedPayloads[0] as any),
      );

      // cada payload pode gerar 1+ unidades → achata tudo
      const unidades = decodedPayloads.flatMap((p) => mapMagicPdfToUnidades(p));

      // regra: lead deve ter no mínimo 1 unidade
      if (!unidades.length) {
        return res
          .status(422)
          .json({ message: "Nenhuma unidade foi decodificada das faturas." });
      }

      // regra: codigoDaUnidadeConsumidora único no request também
      const codes = unidades.map((u) => u.codigoDaUnidadeConsumidora);
      const set = new Set<string>();
      const dup = codes.find((c) => (set.has(c) ? true : (set.add(c), false)));
      if (dup) {
        return res.status(400).json({
          message: `Código da unidade consumidora duplicado no envio: ${dup}`,
        });
      }

      // cria tudo em transação
      const created = await prisma.$transaction(async (tx) => {
        return tx.lead.create({
          data: {
            nomeCompleto: body.nomeCompleto,
            email: body.email,
            telefone: body.telefone,
            unidades: {
              create: unidades.map((u) => ({
                codigoDaUnidadeConsumidora: u.codigoDaUnidadeConsumidora,
                modeloFasico: u.modeloFasico,
                enquadramento: u.enquadramento,
                historicoDeConsumoEmKWH: {
                  create: u.historicoDeConsumoEmKWH.map((c) => ({
                    consumoForaPontaEmKWH: c.consumoForaPontaEmKWH,
                    mesDoConsumo: c.mesDoConsumo,
                  })),
                },
              })),
            },
          },
          include: {
            unidades: { include: { historicoDeConsumoEmKWH: true } },
          },
        });
      });

      return res.status(201).json(created);
    } catch (e: any) {
      // Prisma unique conflict (codigoDaUnidadeConsumidora / email)
      if (e?.code === "P2002") {
        return res.status(409).json({
          message:
            "Conflito de unicidade (email ou código da unidade já existe).",
        });
      }
      if (e instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: "Dados inválidos", issues: e.issues });
      }
      return res.status(500).json({ message: e?.message ?? "Erro interno" });
    }
  },
);

// --------------------
// GET /simulacoes (filtros + paginação)
// q, codigoDaUnidadeConsumidora, modeloFasico, enquadramento, page, pageSize
// --------------------
app.get("/simulacoes", async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const codigo =
      typeof req.query.codigoDaUnidadeConsumidora === "string"
        ? req.query.codigoDaUnidadeConsumidora.trim()
        : "";
    const modeloFasico =
      typeof req.query.modeloFasico === "string" ? req.query.modeloFasico : "";
    const enquadramento =
      typeof req.query.enquadramento === "string"
        ? req.query.enquadramento
        : "";

    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.query.pageSize ?? 10) || 10),
    );

    const AND: any[] = [];

    if (q) {
      AND.push({
        OR: [
          // MySQL (Prisma) não suporta `mode: "insensitive"` aqui.
          // Case-insensitive normalmente vem da collation do banco/coluna (ex: *_ci).
          { nomeCompleto: { contains: q } },
          { email: { contains: q } },
        ],
      });
    }

    if (codigo) {
      AND.push({
        unidades: {
          some: { codigoDaUnidadeConsumidora: { contains: codigo } },
        },
      });
    }

    if (modeloFasico) {
      AND.push({
        unidades: {
          some: { modeloFasico },
        },
      });
    }

    if (enquadramento) {
      AND.push({
        unidades: {
          some: { enquadramento },
        },
      });
    }

    const where = AND.length ? { AND } : {};

    const [total, items] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          unidades: { include: { historicoDeConsumoEmKWH: true } },
        },
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    res.json({ items, total, page, pageSize, totalPages });
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? "Erro interno" });
  }
});

// --------------------
// GET /simulacoes/:id
// --------------------
app.get("/simulacoes/:id", async (req, res) => {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { unidades: { include: { historicoDeConsumoEmKWH: true } } },
    });

    if (!lead)
      return res.status(404).json({ message: "Simulação não encontrada." });

    res.json(lead);
  } catch (e: any) {
    res.status(500).json({ message: e?.message ?? "Erro interno" });
  }
});

const port = Number(process.env.PORT ?? 3333);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`✅ Backend rodando em http://localhost:${port}`);
});
