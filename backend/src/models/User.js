import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null }, // nulo se for login com Google
    googleId: { type: String, default: null, sparse: true },
    avatar: { type: String, default: null }, // foto do perfil do Google ou upload
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);