/**
 * proto.ts — Internal protobuf helpers for ABCI queries (not exported from index)
 */

import type { DexOrder } from "./dex.js";

// ─── ENCODING ───────────────────────────────────────────────────────────────

export function encodeString(fieldNum: number, value: string): Buffer {
  const tag = Buffer.from([(fieldNum << 3) | 2]);
  const strBuf = Buffer.from(value, "utf-8");
  const lenBuf = encodeVarint(strBuf.length);
  return Buffer.concat([tag, lenBuf, strBuf]);
}

export function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  while (value > 0x7f) { bytes.push((value & 0x7f) | 0x80); value >>>= 7; }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

// ─── DECODING ───────────────────────────────────────────────────────────────

export function decodeVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0, shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    shift += 7;
    if (!(b & 0x80)) break;
  }
  return [result, pos];
}

interface ProtoFields { [fieldNum: number]: string | number | Buffer }

function decodeMessage(buf: Buffer): ProtoFields {
  const fields: ProtoFields = {};
  let pos = 0;
  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      try { fields[fieldNum] = data.toString("utf-8"); } catch { fields[fieldNum] = data; }
    } else if (wireType === 0) {
      const [val, valPos] = decodeVarint(buf, pos);
      pos = valPos;
      fields[fieldNum] = val;
    } else if (wireType === 5) {
      pos += 4;
    } else if (wireType === 1) {
      pos += 8;
    } else {
      break;
    }
  }
  return fields;
}

export function extractRepeatedMessages(buf: Buffer, fieldNum: number): Buffer[] {
  const messages: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      if (fNum === fieldNum) messages.push(data);
    } else if (wireType === 0) {
      const [, valPos] = decodeVarint(buf, pos);
      pos = valPos;
    } else if (wireType === 5) { pos += 4; }
    else if (wireType === 1) { pos += 8; }
    else { break; }
  }
  return messages;
}

export function parseOrderFromProto(buf: Buffer): DexOrder {
  const fieldMap: { [key: number]: { type: string; value: string | number } } = {};
  let pos = 0;

  while (pos < buf.length) {
    const [tag, newPos] = decodeVarint(buf, pos);
    pos = newPos;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      const [len, lenPos] = decodeVarint(buf, pos);
      pos = lenPos;
      const data = buf.subarray(pos, pos + len);
      pos += len;
      const str = data.toString("utf-8");
      fieldMap[fieldNum] = { type: "string", value: str };
    } else if (wireType === 0) {
      const [val, valPos] = decodeVarint(buf, pos);
      pos = valPos;
      fieldMap[fieldNum] = { type: "varint", value: val };
    } else if (wireType === 5) { pos += 4; }
    else if (wireType === 1) { pos += 8; }
    else { break; }
  }

  const creator = (fieldMap[1]?.value as string) || "";
  const orderType = (fieldMap[2]?.value as number) || 0;
  const id = (fieldMap[3]?.value as string) || "";
  const baseDenom = (fieldMap[5]?.value as string) || "";
  const quoteDenom = (fieldMap[6]?.value as string) || "";
  const rawPrice = (fieldMap[7]?.value as string) || "0";
  const price = String(parseFloat(rawPrice) || 0);
  const quantity = (fieldMap[8]?.value as string) || "0";
  const side = (fieldMap[9]?.value as number) || 0;
  const remainingQuantity = (fieldMap[10]?.value as string) || "0";
  const remainingBalance = (fieldMap[11]?.value as string) || "0";

  return {
    creator,
    type: orderType === 1 ? "limit" : orderType === 2 ? "market" : String(orderType),
    id,
    baseDenom,
    quoteDenom,
    price,
    quantity,
    side: side === 1 ? "buy" : side === 2 ? "sell" : String(side),
    remainingQuantity,
    remainingBalance,
  };
}

export async function abciQuery(rpcEndpoint: string, path: string, data: Buffer): Promise<Buffer | null> {
  const hexData = data.toString("hex");
  const url = `${rpcEndpoint}/abci_query?path=%22${encodeURIComponent(path)}%22&data=0x${hexData}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const json = await resp.json() as { result?: { response?: { value?: string; code?: number } } };
    const value = json.result?.response?.value;
    if (!value || json.result?.response?.code) return null;
    return Buffer.from(value, "base64");
  } catch { return null; }
}
