import { badRequest } from './http.js';

const toNum = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const text = (v) => (typeof v === 'string' ? v.trim() : '');
const fail = (errors) => { if (Object.keys(errors).length) throw badRequest('Hay datos inválidos en la petición.', errors); };

export const MOVEMENT_TYPES = ['Entrada', 'Salida', 'Ajuste'];
export const ROLES = ['Superadministrador', 'Administrador', 'Encargado'];

export function validateProduct(b) {
  const e = {};
  const code = text(b.code);
  const name = text(b.name);
  const category = text(b.category);
  const description = b.description == null ? '' : text(b.description);
  const price = toNum(b.price);
  const stock = toNum(b.stock ?? 0);
  const minStock = toNum(b.minStock ?? 0);
  const active = b.active === undefined ? true : b.active;

  if (code.length < 2 || code.length > 40) e.code = 'Código requerido (2 a 40 caracteres).';
  if (name.length < 2 || name.length > 120) e.name = 'Nombre requerido (2 a 120 caracteres).';
  if (category.length < 2 || category.length > 60) e.category = 'Categoría requerida (2 a 60 caracteres).';
  if (typeof (b.description ?? '') !== 'string' || description.length > 500) e.description = 'La descripción debe ser texto de hasta 500 caracteres.';
  if (!Number.isFinite(price) || price < 0 || price > 1e9) e.price = 'El precio debe ser un número mayor o igual a 0.';
  if (!Number.isInteger(stock) || stock < 0 || stock > 1e9) e.stock = 'Las existencias deben ser un entero mayor o igual a 0.';
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 1e9) e.minStock = 'El stock mínimo debe ser un entero mayor o igual a 0.';
  if (typeof active !== 'boolean') e.active = 'El estado debe ser verdadero o falso.';
  if (b.date !== undefined && !(typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && !Number.isNaN(Date.parse(b.date)))) {
    e.date = 'La fecha debe tener el formato AAAA-MM-DD.';
  }
  fail(e);
  return { code, name, category, description, price: Math.round(price * 100) / 100, stock, minStock, active, date: b.date };
}

export function validateMovement(b) {
  const e = {};
  const productId = text(b.productId);
  const type = b.type;
  const reason = b.reason == null ? '' : text(b.reason);
  let quantity;
  let targetStock;

  if (!productId) e.productId = 'Selecciona un producto.';
  if (!MOVEMENT_TYPES.includes(type)) e.type = `El tipo debe ser: ${MOVEMENT_TYPES.join(', ')}.`;
  if (typeof (b.reason ?? '') !== 'string' || reason.length > 200) e.reason = 'El motivo debe ser texto de hasta 200 caracteres.';

  if (type === 'Ajuste') {
    // Para un ajuste se acepta targetStock; si no viene, se interpreta quantity como la nueva existencia.
    targetStock = toNum(b.targetStock ?? b.quantity);
    if (!Number.isInteger(targetStock) || targetStock < 0 || targetStock > 1e9) e.targetStock = 'La nueva existencia debe ser un entero mayor o igual a 0.';
  } else if (MOVEMENT_TYPES.includes(type)) {
    quantity = toNum(b.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1e6) e.quantity = 'La cantidad debe ser un entero mayor a 0.';
  }
  fail(e);
  return { productId, type, quantity, targetStock, reason };
}

export function validateUser(b, { creating }) {
  const e = {};
  const name = text(b.name);
  const username = text(b.username).toLowerCase();
  const role = b.role;
  const active = b.active === undefined ? true : b.active;
  const password = b.password;

  if (name.length < 2 || name.length > 80) e.name = 'Nombre requerido (2 a 80 caracteres).';
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) e.username = 'Usuario de 3 a 30 caracteres (letras, números, punto, guion).';
  if (!ROLES.includes(role)) e.role = `El rol debe ser: ${ROLES.join(', ')}.`;
  if (typeof active !== 'boolean') e.active = 'El estado debe ser verdadero o falso.';
  if (password !== undefined && (typeof password !== 'string' || password.length < 8 || password.length > 128)) {
    e.password = 'La contraseña debe tener entre 8 y 128 caracteres.';
  }
  if (creating && password === undefined) { /* se generará una contraseña temporal */ }
  fail(e);
  return { name, username, role, active, password };
}

export function validateSettings(b) {
  const e = {};
  const out = {};
  if (b.businessName !== undefined) { out.businessName = text(b.businessName); if (out.businessName.length < 2 || out.businessName.length > 80) e.businessName = 'Nombre del negocio de 2 a 80 caracteres.'; }
  if (b.currency !== undefined) { out.currency = text(b.currency).toUpperCase(); if (!/^[A-Z]{3}$/.test(out.currency)) e.currency = 'La moneda debe ser un código de 3 letras (ej. GTQ).'; }
  if (b.dateFormat !== undefined) { out.dateFormat = text(b.dateFormat); if (!out.dateFormat || out.dateFormat.length > 20) e.dateFormat = 'Formato de fecha inválido.'; }
  if (b.defaultMinStock !== undefined) { out.defaultMinStock = toNum(b.defaultMinStock); if (!Number.isInteger(out.defaultMinStock) || out.defaultMinStock < 0 || out.defaultMinStock > 1e6) e.defaultMinStock = 'El stock mínimo por defecto debe ser un entero mayor o igual a 0.'; }
  if (b.reportInfo !== undefined) { out.reportInfo = text(b.reportInfo); if (out.reportInfo.length > 200) e.reportInfo = 'La información del reporte admite hasta 200 caracteres.'; }
  fail(e);
  return out;
}
