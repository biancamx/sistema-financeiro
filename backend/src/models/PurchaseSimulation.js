import mongoose from 'mongoose';

const purchaseSimulationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pessoaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Person', required: true, index: true },
    nome: { type: String, required: true, trim: true, maxlength: 120 },
    categoria: { type: String, trim: true, maxlength: 80, default: '' },
    categoriaId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    valorTotal: { type: Number, required: true, min: 0 },
    entrada: { type: Number, default: 0, min: 0 },
    quantidadeParcelas: { type: Number, required: true, min: 1, max: 120 },
    valorParcela: { type: Number, required: true, min: 0 },
    modalidadePagamento: { type: String, enum: ['dinheiro', 'pix', 'debito', 'cartao_credito', 'parcelamento_entrada', 'outras'], required: true },
    cartaoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', default: null },
    taxaJuros: { type: Number, default: 0, min: 0, max: 100 },
    dataPrevista: { type: String, required: true },
    horizonteProjecao: { type: Number, enum: [12, 24, 36], default: 12 },
    status: { type: String, enum: ['planejada', 'aprovada', 'descartada', 'convertida'], default: 'planejada' },
    observacoes: { type: String, maxlength: 1000, default: '' },
    resultadoResumo: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

purchaseSimulationSchema.index({ userId: 1, pessoaId: 1, createdAt: -1 });

export const PurchaseSimulation = mongoose.model('PurchaseSimulation', purchaseSimulationSchema);
