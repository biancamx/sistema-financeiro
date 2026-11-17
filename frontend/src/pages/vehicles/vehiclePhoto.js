const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateVehiclePhoto(file) {
  if (!PHOTO_TYPES.has(file.type)) throw new Error('Use uma imagem JPG, PNG ou WebP.');
  if (file.size > MAX_PHOTO_SIZE) throw new Error('A imagem deve ter até 5 MB.');
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir esta imagem.'));
    };
    image.src = url;
  });
}

async function resizeImage(image, maxSide, type) {
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a imagem.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.88));
  if (!blob) throw new Error('Não foi possível preparar a imagem.');
  return new File([blob], `vehicle-photo.${blob.type.split('/')[1]}`, { type: blob.type });
}

export async function prepareVehiclePhoto(file) {
  validateVehiclePhoto(file);
  const image = await loadImage(file);
  const [photo, thumbnail] = await Promise.all([
    resizeImage(image, 800, file.type),
    resizeImage(image, 120, file.type),
  ]);
  if (photo.size > MAX_PHOTO_SIZE) throw new Error('A imagem reduzida excedeu o limite de 5 MB.');
  return { photo, thumbnail };
}
