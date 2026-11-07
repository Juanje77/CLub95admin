/** Reduce una foto del celular a un JPEG liviano (máx. 1280 px, ≤ ~500 KB) para guardarla como comprobante. Solo cliente. */
export async function compressToJpeg(file: File, maxSide = 1280, maxChars = 600_000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("No se pudo leer la foto."));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (let q = 0.75; q >= 0.3; q -= 0.15) {
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length <= maxChars) return data;
    }
    throw new Error("La foto es demasiado grande, sacala más cerca o con menos resolución.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
