const WASM_PAGE_BYTES = 64 * 1024;

export function capWasmMemory(binary, maximumPages) {
  if (!Number.isSafeInteger(maximumPages) || maximumPages <= 0) {
    throw new Error("WASM_MEMORY_CAP_INVALID");
  }
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  assertHeader(bytes);
  const output = [bytes.subarray(0, 8)];
  let offset = 8;
  let memorySections = 0;
  while (offset < bytes.byteLength) {
    const id = bytes[offset++];
    const length = readUnsignedLeb(bytes, offset);
    offset = length.next;
    const end = offset + length.value;
    if (end > bytes.byteLength) throw new Error("WASM_SECTION_TRUNCATED");
    const payload = bytes.subarray(offset, end);
    const patched = id === 5 ? patchMemorySection(payload, maximumPages) : payload;
    if (id === 5) memorySections += 1;
    output.push(Uint8Array.of(id), encodeUnsignedLeb(patched.byteLength), patched);
    offset = end;
  }
  if (memorySections !== 1) throw new Error("WASM_MEMORY_SECTION_INVALID");
  return concatenate(output);
}

export function inspectWasmMemory(binary) {
  const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
  assertHeader(bytes);
  let offset = 8;
  const memories = [];
  while (offset < bytes.byteLength) {
    const id = bytes[offset++];
    const length = readUnsignedLeb(bytes, offset);
    offset = length.next;
    const end = offset + length.value;
    if (end > bytes.byteLength) throw new Error("WASM_SECTION_TRUNCATED");
    if (id === 5) memories.push(...readMemorySection(bytes.subarray(offset, end)));
    offset = end;
  }
  if (memories.length !== 1) throw new Error("WASM_MEMORY_COUNT_INVALID");
  return {
    minimumPages: memories[0].minimumPages,
    maximumPages: memories[0].maximumPages,
    maximumBytes: memories[0].maximumPages === undefined
      ? undefined
      : memories[0].maximumPages * WASM_PAGE_BYTES
  };
}

function patchMemorySection(payload, maximumPages) {
  const count = readUnsignedLeb(payload, 0);
  let offset = count.next;
  const output = [encodeUnsignedLeb(count.value)];
  for (let index = 0; index < count.value; index += 1) {
    const flags = readUnsignedLeb(payload, offset);
    offset = flags.next;
    if ((flags.value & 0b100) !== 0) throw new Error("WASM_MEMORY64_UNSUPPORTED");
    const minimum = readUnsignedLeb(payload, offset);
    offset = minimum.next;
    let declaredMaximum;
    if ((flags.value & 0b001) !== 0) {
      const maximum = readUnsignedLeb(payload, offset);
      offset = maximum.next;
      declaredMaximum = maximum.value;
    }
    if (minimum.value > maximumPages) throw new Error("WASM_MEMORY_MINIMUM_EXCEEDS_CAP");
    output.push(
      encodeUnsignedLeb(flags.value | 0b001),
      encodeUnsignedLeb(minimum.value),
      encodeUnsignedLeb(Math.min(declaredMaximum ?? maximumPages, maximumPages))
    );
  }
  if (offset !== payload.byteLength) throw new Error("WASM_MEMORY_SECTION_INVALID");
  return concatenate(output);
}

function readMemorySection(payload) {
  const count = readUnsignedLeb(payload, 0);
  let offset = count.next;
  const memories = [];
  for (let index = 0; index < count.value; index += 1) {
    const flags = readUnsignedLeb(payload, offset);
    offset = flags.next;
    if ((flags.value & 0b100) !== 0) throw new Error("WASM_MEMORY64_UNSUPPORTED");
    const minimum = readUnsignedLeb(payload, offset);
    offset = minimum.next;
    let maximum;
    if ((flags.value & 0b001) !== 0) {
      const parsedMaximum = readUnsignedLeb(payload, offset);
      offset = parsedMaximum.next;
      maximum = parsedMaximum.value;
    }
    memories.push({ minimumPages: minimum.value, maximumPages: maximum });
  }
  if (offset !== payload.byteLength) throw new Error("WASM_MEMORY_SECTION_INVALID");
  return memories;
}

function readUnsignedLeb(bytes, start) {
  let value = 0;
  let shift = 0;
  let offset = start;
  for (let count = 0; count < 5; count += 1) {
    if (offset >= bytes.byteLength) throw new Error("WASM_LEB_TRUNCATED");
    const byte = bytes[offset++];
    value += (byte & 0x7f) * (2 ** shift);
    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value)) throw new Error("WASM_LEB_OVERFLOW");
      return { value, next: offset };
    }
    shift += 7;
  }
  throw new Error("WASM_LEB_OVERFLOW");
}

function encodeUnsignedLeb(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("WASM_LEB_INVALID");
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (value !== 0);
  return Uint8Array.from(bytes);
}

function assertHeader(bytes) {
  const expected = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  if (bytes.byteLength < expected.length || expected.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("WASM_HEADER_INVALID");
  }
}

function concatenate(parts) {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}
