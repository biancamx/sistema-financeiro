import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { analyzeSpreadsheet } from './spreadsheet.reader.js';
import { executeSpreadsheetImport } from './spreadsheet.writer.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

export function importRoutes() {
  const router = Router();
  router.use(requireAuth());

  // POST /api/import/preview - Analisa e devolve a prévia
  router.post('/preview', upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }
      const data = analyzeSpreadsheet(req.file.buffer);
      res.json({ success: true, data });
    } catch (err) {
      console.error('[IMPORT ERROR]', err);
      res.status(500).json({ error: err.message || 'Erro ao processar planilha' });
    }
  });

  // POST /api/import/execute - Grava os dados da prévia no banco
  router.post('/execute', async (req, res) => {
    try {
      const { analyzedData, userDecisions } = req.body;
      if (!analyzedData) {
        return res.status(400).json({ error: 'Dados analisados não fornecidos.' });
      }
      const summary = await executeSpreadsheetImport(req.user._id, analyzedData, userDecisions || {});
      res.json({ success: true, summary, message: 'Dados importados com sucesso!' });
    } catch (err) {
      console.error('[EXECUTE ERROR]', err);
      res.status(500).json({ error: err.message || 'Erro ao gravar dados no banco' });
    }
  });

  return router;
}