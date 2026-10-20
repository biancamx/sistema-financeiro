import 'dotenv/config';
import fs from 'node:fs';
import initSqlJs from 'sql.js';

import { connectMongo } from './mongo.js';
import { User } from '../models/User.js';
import { Person } from '../models/Person.js';
import { Card } from '../models/Card.js';
import { Purchase } from '../models/Purchase.js';
import { MonthlyBudget } from '../models/MonthlyBudget.js';

const sqlitePath = 'C:\\Users\\Pessoa 01\\Documents\\financeiro\\backend\\data\\financeiro.db';

// Utilitário para converter o resultado do sql.js em objetos normais { col: val }
function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function migrate() {
  console.log('🚀 Iniciando processo de migração do SQLite para o MongoDB Atlas...');

  if (!fs.existsSync(sqlitePath)) {
    console.error(`❌ Banco SQLite não encontrado em: ${sqlitePath}`);
    process.exit(1);
  }

  // 1. Lê o arquivo SQLite na memória de forma pura
  const fileBuffer = fs.readFileSync(sqlitePath);
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database(fileBuffer);
  console.log(`📂 Banco SQLite carregado com sucesso (${fileBuffer.length} bytes)!`);

  // 2. Conecta ao MongoDB Atlas
  await connectMongo();

  const userMap = new Map();
  const personMap = new Map();
  const cardMap = new Map();

  try {
    // -------------------------------------------------------------
    // FASE A: MIGRAR USUÁRIOS
    // -------------------------------------------------------------
    const users = queryAll(sqlite, 'SELECT * FROM users');
    console.log(`\n👤 Migrando ${users.length} usuário(s)...`);

    for (const u of users) {
      const email = String(u.email || '').toLowerCase().trim();
      let mongoUser = await User.findOne({ email });
      if (!mongoUser) {
        mongoUser = await User.create({
          name: u.name,
          email,
          passwordHash: u.password_hash || null,
          googleId: u.google_id || null,
        });
      }
      userMap.set(u.id, mongoUser._id);
    }
    console.log('✅ Usuários migrados com sucesso!');

    // -------------------------------------------------------------
    // FASE B: MIGRAR PESSOAS
    // -------------------------------------------------------------
    const people = queryAll(sqlite, 'SELECT * FROM people');
    console.log(`\n👥 Migrando ${people.length} pessoa(s)...`);

    for (const p of people) {
      const targetUserId = userMap.get(p.user_id);
      if (!targetUserId) continue;

      let mongoPerson = await Person.findOne({ userId: targetUserId, name: p.name });
      if (!mongoPerson) {
        mongoPerson = await Person.create({
          userId: targetUserId,
          name: p.name,
          phone: p.phone || null,
          email: p.email || null,
          birthDate: p.birth_date || null,
          pixKey: p.pix_key || null,
          avatar: p.avatar || null,
          notes: p.notes || null,
          shareToken: p.share_token || undefined,
        });
      }
      personMap.set(p.id, mongoPerson._id);
    }
    console.log('✅ Pessoas migradas com sucesso!');

    // -------------------------------------------------------------
    // FASE C: MIGRAR CARTÕES DE CRÉDITO
    // -------------------------------------------------------------
    const cards = queryAll(sqlite, 'SELECT * FROM cards');
    console.log(`\n💳 Migrando ${cards.length} cartão(ões)...`);

    for (const c of cards) {
      const targetUserId = userMap.get(c.user_id);
      if (!targetUserId) continue;

      const holderId = c.holder_person_id ? personMap.get(c.holder_person_id) : null;

      let mongoCard = await Card.findOne({ userId: targetUserId, name: c.name });
      if (!mongoCard) {
        mongoCard = await Card.create({
          userId: targetUserId,
          name: c.name,
          limit: c.limit || 0,
          color: c.color || '#0f6b66',
          bank: c.bank || 'outro',
          brand: c.brand || 'outro',
          lastDigits: c.last_digits || null,
          holderPersonId: holderId || null,
          image: c.image || null,
          dueDay: c.due_day || 10,
          closingDay: c.closing_day || 3,
        });
      }
      cardMap.set(c.id, mongoCard._id);
    }
    console.log('✅ Cartões migrados com sucesso!');

    // -------------------------------------------------------------
    // FASE D: MIGRAR COMPRAS E PARCELAS (EMBUTIDAS)
    // -------------------------------------------------------------
    const purchases = queryAll(sqlite, 'SELECT * FROM purchases');
    console.log(`\n🛍️ Migrando ${purchases.length} compra(s)...`);

    let totalInstallmentsCount = 0;

    for (const pur of purchases) {
      const targetUserId = userMap.get(pur.user_id);
      const targetPersonId = personMap.get(pur.person_id);
      const targetCardId = pur.card_id ? cardMap.get(pur.card_id) : null;

      if (!targetUserId || !targetPersonId) continue;

      const rawInstallments = queryAll(
        sqlite,
        'SELECT * FROM installments WHERE purchase_id = ? ORDER BY installment_number ASC',
        [pur.id]
      );
      totalInstallmentsCount += rawInstallments.length;

      const formattedInstallments = rawInstallments.map((inst) => ({
        installmentNumber: inst.installment_number,
        month: inst.month,
        year: inst.year,
        amount: Number(inst.amount),
        paidAmount: Number(inst.paid_amount || 0),
        paid: inst.paid === 1,
      }));

      await Purchase.create({
        userId: targetUserId,
        personId: targetPersonId,
        cardId: targetCardId || null,
        description: pur.description,
        totalAmount: Number(pur.total_amount),
        totalInstallments: Number(pur.total_installments),
        splitGroupId: pur.split_group_id || null,
        installments: formattedInstallments,
      });
    }
    console.log(`✅ ${purchases.length} compras e ${totalInstallmentsCount} parcelas migradas com sucesso!`);

    // -------------------------------------------------------------
    // FASE E: MIGRAR PLANILHA MENSAL (BUDGETS)
    // -------------------------------------------------------------
    let budgets = [];
    try {
      budgets = queryAll(sqlite, 'SELECT * FROM monthly_budgets');
    } catch {
      budgets = [];
    }

    if (budgets.length > 0) {
      console.log(`\n📊 Migrando ${budgets.length} linha(s) da planilha mensal...`);
      for (const b of budgets) {
        const targetUserId = userMap.get(b.user_id);
        const targetPersonId = personMap.get(b.person_id);
        if (!targetUserId || !targetPersonId) continue;

        await MonthlyBudget.create({
          userId: targetUserId,
          personId: targetPersonId,
          month: Number(b.month),
          year: Number(b.year),
          section: b.section,
          category: b.category,
          label: b.label,
          amount: Number(b.amount || 0),
        });
      }
      console.log('✅ Planilha mensal migrada com sucesso!');
    }

    console.log('\n🎉 ======================================================== 🎉');
    console.log('   MIGRAÇÃO CONCLUÍDA! TODOS OS DADOS ESTÃO NO MONGO ATLAS!   ');
    console.log('🎉 ======================================================== 🎉\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro durante a migração:', err);
    process.exit(1);
  }
}

migrate();