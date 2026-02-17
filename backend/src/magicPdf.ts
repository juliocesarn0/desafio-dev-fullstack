import axios from "axios";
import FormData from "form-data";

const MAGIC_PDF_URL = process.env.MAGIC_PDF_URL || "";

export async function decodeContaDeEnergia(file: {
  buffer: Buffer;
  filename: string;
  mimetype: string;
}) {
  if (!MAGIC_PDF_URL) {
    throw new Error("MAGIC_PDF_URL não configurada no .env");
  }

  const form = new FormData();
  form.append("file", file.buffer, {
    filename: file.filename,
    contentType: file.mimetype,
  });

  const res = await axios.post(MAGIC_PDF_URL, form, {
    headers: form.getHeaders(),
    timeout: 60_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  return res.data as unknown;
}
