// Tiny stack VM (ISA v1) for make.fun tiny-stack-vm-01. Reads
// $MAKEFUN_INPUT_DIR/<id>/{program.bin,input.bin}, writes
// $MAKEFUN_OUTPUT_DIR/<id>/{stdout.bin,exit.txt}. Node 22, no deps.
// Traps: 2 underflow, 3 overflow, 4 div0, 5 opcode, 6 memory,
// 7 call depth, 8 ret empty, 9 pc, 10 steps, 11 output.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table, 5 chars per opcode: hex byte, immediate bytes, pops, pushes.
const T = '00000' + '01101' + '02401' + '03010' + '04012' + '05022' + '06023' + '07033' +
  '10021' + '11021' + '12021' + '13021' + '14021' + '15021' + '16021' + '17011' +
  '18021' + '19021' + '1a021' + '1b011' + '1c021' + '1d021' + '1e021' +
  '20021' + '21021' + '22021' +
  '30200' + '31210' + '32210' + '33200' + '34000' +
  '40011' + '41020' +
  '50010' + '51010' + '52001' + '53010';
const DEF = new Uint8Array(256);
const IMM = new Uint8Array(256);
const POP = new Uint8Array(256);
const PSH = new Uint8Array(256);
for (let k = 0; k < T.length; k += 5) {
  const o = parseInt(T.slice(k, k + 2), 16);
  DEF[o] = 1;
  IMM[o] = +T[k + 2];
  POP[o] = +T[k + 3];
  PSH[o] = +T[k + 4];
}

/** Runs one program on its input bytes: what it wrote, its exit code. */
function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; exit: number } {
  const n = p.length;
  const s = new Int32Array(256);
  const c = new Int32Array(64);
  const m = new Int32Array(256);
  const o = new Uint8Array(65536);
  const t = new Uint8Array(12); // scratch for one PRINT's decimal digits
  let sp = 0;
  let cp = 0;
  let ol = 0;
  let ip = 0;
  let pc = 0;
  let steps = 0;
  const end = (e: number) => ({ out: o.subarray(0, ol), exit: e });
  for (;;) {
    // One step, in ISA.md's order: step limit, pc range, opcode, immediate.
    if (steps === 1e6) return end(10);
    if (pc < 0 || pc >= n) return end(9);
    const op = p[pc];
    if (!DEF[op]) return end(5);
    const im = IMM[op];
    if (pc + im >= n) return end(9);
    steps++;
    const nx = pc + 1 + im;
    if (sp < POP[op]) return end(2);
    if (sp - POP[op] + PSH[op] > 256) return end(3);
    pc = nx;
    switch (op) {
      case 0x00:
        return end(0);
      case 0x01:
        s[sp++] = (p[nx - 1] << 24) >> 24;
        break;
      case 0x02:
        s[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24);
        break;
      case 0x03:
        sp--;
        break;
      case 0x04:
        s[sp] = s[sp - 1];
        sp++;
        break;
      case 0x05:
        {
          const v = s[sp - 1];
          s[sp - 1] = s[sp - 2];
          s[sp - 2] = v;
        }
        break;
      case 0x06:
        s[sp] = s[sp - 2];
        sp++;
        break;
      case 0x07:
        {
          const v = s[sp - 3];
          s[sp - 3] = s[sp - 2];
          s[sp - 2] = s[sp - 1];
          s[sp - 1] = v;
        }
        break;
      case 0x17:
        s[sp - 1] = -s[sp - 1] | 0;
        break;
      case 0x1b:
        s[sp - 1] = ~s[sp - 1];
        break;
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16:
      case 0x18:
      case 0x19:
      case 0x1a:
      case 0x1c:
      case 0x1d:
      case 0x1e:
      case 0x20:
      case 0x21:
      case 0x22: {
        const b = s[sp - 1];
        const a = s[sp - 2];
        if (op >= 0x13 && op <= 0x16 && b === 0) return end(4);
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        else if (op === 0x14) r = b === -1 ? 0 : (a % b) | 0;
        else if (op === 0x15) r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        else if (op === 0x16) r = ((a >>> 0) % (b >>> 0)) | 0;
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        s[sp++] = r;
        break;
      }
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        if (op === 0x30) {
          pc = nx + rel;
        } else {
          const v = s[--sp];
          if (op === 0x31 ? v === 0 : v !== 0) pc = nx + rel;
        }
        break;
      }
      case 0x33:
        if (cp === 64) return end(7);
        c[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return end(8);
        pc = c[--cp];
        break;
      case 0x40: {
        const a = s[sp - 1];
        if (a < 0 || a >= 256) return end(6);
        s[sp - 1] = m[a];
        break;
      }
      case 0x41: {
        const a = s[sp - 1];
        const v = s[sp - 2];
        if (a < 0 || a >= 256) return end(6);
        m[a] = v;
        sp -= 2;
        break;
      }
      case 0x50: {
        const v = s[sp - 1];
        let q = 12;
        let u = v < 0 ? -v : v; // -(-2147483648) is 2147483648, exact as a double
        if (u === 0) {
          t[--q] = 48;
        } else {
          while (u > 0) {
            t[--q] = 48 + (u % 10);
            u = Math.floor(u / 10);
          }
        }
        if (v < 0) t[--q] = 45;
        if (ol + (12 - q) > 65536) return end(11); // writes none of its bytes
        o.set(t.subarray(q), ol);
        ol += 12 - q;
        sp--;
        break;
      }
      case 0x51:
        if (ol + 1 > 65536) return end(11);
        o[ol++] = s[--sp] & 255;
        break;
      case 0x52:
        s[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        return end(s[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(
    new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))),
  );
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
