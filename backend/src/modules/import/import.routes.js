import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { analyzeSpreadsheet } from './spreadsheet.reader.js';
import { executeSpreadsheetImport } from './spreadsheet.writer.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function withImportErrorHandling(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error('[IMPORT ROUTE ERROR]', error);
      const message = error instanceof Error ? error.message : 'Erro ao processar a importação.';
      if (!res.headersSent) {
        res.status(500).json({ error: message, ok: false });
      }
    }
  };
}

export function importRoutes() {
  const router = Router();
  router.use(requireAuth());

  // POST /api/import/preview - Analisa e devolve a prévia
  router.post('/preview', upload.single('file'), withImportErrorHandling((req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    const data = analyzeSpreadsheet(req.file.buffer);
    return res.json({ success: true, data });
  }));

  // POST /api/import/execute - Grava os dados da prévia no banco
  router.post('/execute', withImportErrorHandling(async (req, res) => {
    const { analyzedData, userDecisions } = req.body ?? {};
    if (!analyzedData || typeof analyzedData !== 'object') {
      return res.status(400).json({ error: 'Dados analisados não fornecidos.' });
    }
    const validDecisions = userDecisions && typeof userDecisions === 'object' ? userDecisions : {};
    const summary = await executeSpreadsheetImport(req.user._id, analyzedData, validDecisions);
    return res.json({ success: true, summary, message: 'Dados importados com sucesso!' });
  }));

  return router;
}