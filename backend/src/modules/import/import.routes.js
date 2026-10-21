import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../../middleware/auth.js';
import { processSpreadsheetImport, undoSpreadsheetImport } from './import.service.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function importRoutes(db) {
  const router = Router();
  router.use(requireAuth(db));

  // POST: Importar Planilha
  router.post('/spreadsheet', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }

      const results = await processSpreadsheetImport(db, req.user.id, req.file.buffer, {
        replaceExisting: req.body?.replaceExisting === 'true',
      });

      res.json({
        success: true,
        message: 'Planilha importada com sucesso!',
        data: results,
      });
    } catch (err) {
      console.error('Erro na importação:', err);
      res.status(500).json({ error: err.message || 'Erro ao processar a planilha' });
    }
  });

  // POST: Desfazer Lançamentos Importados
  router.post('/undo', (req, res) => {
    try {
      const { batchId } = req.body;
      const result = undoSpreadsheetImport(db, req.user.id, batchId || null);
      res.json({
        success: true,
        message: `${result.undoneCount} lançamento(s) desfeito(s) com sucesso!`,
      });
    } catch (err) {
      console.error('Erro ao desfazer importação:', err);
      res.status(500).json({ error: 'Erro ao desfazer importação' });
    }
  });

  // POST: Reset Geral (Limpar Lançamentos ou Zerar Tudo)
  router.post('/reset', (req, res) => {
    const { target } = req.body;
    const userId = req.user.id;

    console.log(`[RESET] Executando reset para o usuário ${userId} (Alvo: ${target || 'purchases_only'})`);

    try {
      db.pragma('foreign_keys = OFF');

      let purchasesCount = 0;
      let cardsCount = 0;
      let peopleCount = 0;

      const runReset = db.transaction(() => {
        // 1. Sempre apaga parcelas e compras do usuário
        db.prepare(`
          DELETE FROM installments 
          WHERE purchase_id IN (SELECT id FROM purchases WHERE user_id = ?)
        `).run(userId);

        const pDel = db.prepare('DELETE FROM purchases WHERE user_id = ?').run(userId);
        purchasesCount = pDel.changes;

        // 2. Se for 'all', limpa cartões, pessoas, planilhas e despesas de veículos
        if (target === 'all') {
          try {
            db.prepare('DELETE FROM vehicle_expense_splits WHERE expense_id IN (SELECT id FROM vehicle_expenses WHERE user_id = ?)').run(userId);
            db.prepare('DELETE FROM vehicle_expenses WHERE user_id = ?').run(userId);
          } catch {}

          try {
            db.prepare('DELETE FROM monthly_budgets WHERE user_id = ?').run(userId);
          } catch {}

          try {
            db.prepare('DELETE FROM month_status WHERE user_id = ?').run(userId);
          } catch {}

          const cDel = db.prepare('DELETE FROM cards WHERE user_id = ?').run(userId);
          cardsCount = cDel.changes;

          const peDel = db.prepare('DELETE FROM people WHERE user_id = ?').run(userId);
          peopleCount = peDel.changes;
        }
      });

      runReset();
      db.pragma('foreign_keys = ON');

      console.log(`[RESET] Sucesso: ${purchasesCount} compras, ${cardsCount} cartões, ${peopleCount} pessoas apagadas.`);

      res.json({
        success: true,
        message: target === 'all'
          ? `Reset completo! Foram excluídos ${purchasesCount} compras, ${cardsCount} cartões e ${peopleCount} pessoas.`
          : `Limpeza concluída! ${purchasesCount} compra(s) e todas as suas parcelas foram apagadas com sucesso.`,
      });
    } catch (err) {
      db.pragma('foreign_keys = ON');
      console.error('Erro no reset:', err);
      res.status(500).json({ error: 'Erro ao executar a limpeza no banco de dados.' });
    }
  });

  return router;
}