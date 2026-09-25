/** Reads a Blob fully into memory (FileReader fallback for environments
 * without `Blob.arrayBuffer`). */
function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** On Android Chrome a picked File is a live handle to the device file that
 * can become unreadable ("File could not be read! Code=0") once its input is
 * reset, so copy it into memory before resetting the input. Falls back to the
 * original handle when the copy fails; the decoder reports its own failure. */
export async function copyToMemory(file: Blob): Promise<Blob> {
  try {
    return new Blob([await readBytes(file)], { type: file.type })
  } catch {
    return file
  }
}
