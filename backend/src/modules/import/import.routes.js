import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { analyzeSpreadsheet } from './spreadsheet.reader.js';
import { executeSpreadsheetImport } from './spreadsheet.writer.js';
import { analyzePdfPurchases } from './pdf.reader.js';
import { executePdfPurchaseImport } from './pdf.writer.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function withImportErrorHandling(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro ao processar a importação.';
      console.error('[IMPORT ROUTE ERROR]', message);
      if (!res.headersSent) {
        res.status(error?.statusCode ?? 500).json({ error: message, ok: false });
      }
    }
  };
}

export function importRoutes() {
  const router = Router();
  router.use(requireAuth());

  // POST /api/import/preview - Analisa e devolve a prévia
  router.post('/preview', upload.single('file'), withImportErrorHandling(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    const extension = req.file.originalname.toLowerCase().split('.').pop();
    let data;
    if (extension === 'pdf') {
      data = await analyzePdfPurchases(req.file.buffer, String(req.user._id));
    } else if (['xlsx', 'xls'].includes(extension)) {
      data = analyzeSpreadsheet(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Envie .pdf, .xlsx ou .xls.' });
    }
    return res.json({ success: true, data });
  }));

  // POST /api/import/execute - Grava os dados da prévia no banco
  router.post('/execute', withImportErrorHandling(async (req, res) => {
    const { analyzedData, userDecisions } = req.body ?? {};
    if (!analyzedData || typeof analyzedData !== 'object') {
      return res.status(400).json({ error: 'Dados analisados não fornecidos.' });
    }
    const validDecisions = userDecisions && typeof userDecisions === 'object' ? userDecisions : {};
    const summary = analyzedData.sourceType === 'pdf'
      ? await executePdfPurchaseImport(req.user._id, analyzedData)
      : await executeSpreadsheetImport(req.user._id, analyzedData, validDecisions);
    return res.json({ success: true, summary, message: 'Dados importados com sucesso!' });
  }));

  return router;
}