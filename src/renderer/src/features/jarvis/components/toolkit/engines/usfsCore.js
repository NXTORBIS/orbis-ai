/**
 * User-space filesystem engine.
 *
 * A real on-disk layout, not a simulation of one: block 0 carries a superblock,
 * the next blocks hold the block bitmap, then the inode table, then data blocks.
 * An inode addresses its data through eight direct pointers plus a single indirect
 * block, and directories are ordinary files holding fixed 32-byte entries. The
 * whole thing serialises to a byte image that can be written out and read back.
 *
 * The engine verifies itself two ways: an fsck that walks the structure and checks
 * every invariant (cross-links, orphans, bitmap disagreement, link counts, sizes),
 * and a model-based differential test that runs a random operation sequence against
 * both the filesystem and a plain in-memory reference, comparing the two after
 * every single operation.
 */

export const BLOCK_SIZE = 4096;
export const MAGIC = 'USFS0001';
export const SLOT = 32;
export const NAME_MAX = 26;
const INODE_SIZE = 128;
const DIRECT = 8;
const MODE_FILE = 1;
const MODE_DIR = 2;

const readU32 = (bytes, off) => (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
const writeU32 = (bytes, off, value) => {
  bytes[off] = value & 0xff;
  bytes[off + 1] = (value >>> 8) & 0xff;
  bytes[off + 2] = (value >>> 16) & 0xff;
  bytes[off + 3] = (value >>> 24) & 0xff;
};

const encodeName = (name) => {
  const text = String(name);
  if (text.length > NAME_MAX) throw new Error(`Names are limited to ${NAME_MAX} characters.`);
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};
const decodeName = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
};

/** FNV-1a — a small synchronous digest, used to compare file contents in tests. */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const emptyInode = () => ({ mode: 0, links: 0, size: 0, direct: new Array(DIRECT).fill(0), indirect: 0, ctime: 0, mtime: 0 });

export function createImage({ blocks = 640, inodes = 128, blockSize = BLOCK_SIZE } = {}) {
  const bitmapBlocks = Math.max(1, Math.ceil(blocks / 8 / blockSize));
  const inodeBlocks = Math.max(1, Math.ceil((inodes * INODE_SIZE) / blockSize));
  const dataStart = 1 + bitmapBlocks + inodeBlocks;
  if (dataStart >= blocks) throw new Error('The image is too small for its own metadata — add more blocks.');
  const fs = {
    blockSize,
    blockCount: blocks,
    inodeCount: inodes,
    bitmapBlocks,
    inodeBlocks,
    dataStart,
    blocks: Array.from({ length: blocks }, () => new Uint8Array(blockSize)),
    bitmap: new Uint8Array(blocks),
    inodes: Array.from({ length: inodes }, emptyInode),
    root: 1,
    generation: 1,
  };
  for (let b = 0; b < dataStart; b += 1) fs.bitmap[b] = 1;
  fs.inodes[fs.root] = { ...emptyInode(), mode: MODE_DIR, links: 2, ctime: 0, mtime: 0 };
  const first = allocBlock(fs);
  fs.inodes[fs.root].direct[0] = first;
  writeEntryInto(fs, first, 0, fs.root, MODE_DIR, '.');
  writeEntryInto(fs, first, 1, fs.root, MODE_DIR, '..');
  fs.inodes[fs.root].size = 2 * SLOT;
  return fs;
}

const perBlock = (fs) => fs.blockSize / 4;

function allocBlock(fs) {
  for (let b = fs.dataStart; b < fs.blockCount; b += 1) {
    if (!fs.bitmap[b]) {
      fs.bitmap[b] = 1;
      fs.blocks[b] = new Uint8Array(fs.blockSize);
      return b;
    }
  }
  throw new Error('The filesystem is out of space.');
}

function freeBlock(fs, b) {
  fs.bitmap[b] = 0;
  fs.blocks[b] = new Uint8Array(fs.blockSize);
}

function allocInode(fs) {
  for (let i = 2; i < fs.inodeCount; i += 1) {
    if (!fs.inodes[i].mode) {
      fs.inodes[i] = emptyInode();
      return i;
    }
  }
  throw new Error('No inodes left in this image.');
}

/** Data blocks in order — the indirect pointer block itself is not data. */
function dataBlocks(fs, ino) {
  if (!ino || !Array.isArray(ino.direct)) throw new Error('An inode was read without its block pointer array — the structure is inconsistent.');
  const out = ino.direct.filter((b) => b);
  if (ino.indirect) {
    const ind = fs.blocks[ino.indirect];
    for (let i = 0; i < perBlock(fs); i += 1) {
      const b = readU32(ind, i * 4);
      if (b) out.push(b);
    }
  }
  return out;
}

function readFile(fs, ino) {
  const blocks = dataBlocks(fs, ino);
  const out = new Uint8Array(ino.size);
  for (let i = 0; i < blocks.length; i += 1) {
    const start = i * fs.blockSize;
    if (start >= out.length) break;
    const len = Math.min(fs.blockSize, out.length - start);
    out.set(fs.blocks[blocks[i]].subarray(0, len), start);
  }
  return out;
}

/** Replaces an inode's contents, releasing what it held first so a rewrite cannot stall on space. */
function setFileData(fs, ino, bytes, { forceBlock = false } = {}) {
  for (const b of dataBlocks(fs, ino)) freeBlock(fs, b);
  if (ino.indirect) {
    freeBlock(fs, ino.indirect);
    ino.indirect = 0;
  }
  ino.direct = new Array(DIRECT).fill(0);
  ino.size = bytes.length;
  const need = Math.max(forceBlock ? 1 : 0, Math.ceil(bytes.length / fs.blockSize));
  const limit = DIRECT + perBlock(fs);
  if (need > limit) throw new Error(`A file is limited to ${Math.round((limit * fs.blockSize) / 1024)} KB in this image.`);
  // blocks are attached as they are taken, so a failure part-way leaves nothing untracked
  for (let i = 0; i < need; i += 1) {
    const block = allocBlock(fs);
    if (i < DIRECT) ino.direct[i] = block;
    else {
      if (!ino.indirect) ino.indirect = allocBlock(fs);
      writeU32(fs.blocks[ino.indirect], (i - DIRECT) * 4, block);
    }
  }
  const allocated = dataBlocks(fs, ino);
  for (let i = 0; i < allocated.length; i += 1) {
    const start = i * fs.blockSize;
    const len = Math.min(fs.blockSize, Math.max(0, bytes.length - start));
    if (len > 0) fs.blocks[allocated[i]].set(bytes.subarray(start, start + len));
  }
  ino.mtime = fs.generation;
}

const writeEntryInto = (fs, block, slot, id, type, name) => {
  const bytes = encodeName(name);
  const at = slot * SLOT;
  const target = fs.blocks[block];
  writeU32(target, at, id);
  target[at + 4] = type;
  target[at + 5] = bytes.length;
  target.set(bytes, at + 6);
};

function dirEntries(fs, dirIno) {
  const data = readFile(fs, fs.inodes[dirIno]);
  const out = [];
  for (let off = 0; off + SLOT <= data.length; off += SLOT) {
    const id = readU32(data, off);
    if (!id) continue;
    const len = Math.min(data[off + 5], NAME_MAX);
    out.push({ slot: off / SLOT, inode: id, type: data[off + 4], name: decodeName(data.subarray(off + 6, off + 6 + len)) });
  }
  return out;
}

function addEntry(fs, dirIno, id, type, name) {
  const data = readFile(fs, fs.inodes[dirIno]);
  let slot = -1;
  for (let off = 0; off + SLOT <= data.length; off += SLOT) {
    if (!readU32(data, off)) {
      slot = off / SLOT;
      break;
    }
  }
  const grow = slot === -1;
  const next = new Uint8Array(data.length + (grow ? SLOT : 0));
  next.set(data);
  const at = (grow ? data.length / SLOT : slot) * SLOT;
  const bytes = encodeName(name);
  writeU32(next, at, id);
  next[at + 4] = type;
  next[at + 5] = bytes.length;
  next.set(bytes, at + 6);
  setFileData(fs, fs.inodes[dirIno], next, { forceBlock: true });
  return at / SLOT;
}

function removeEntry(fs, dirIno, slot) {
  const data = readFile(fs, fs.inodes[dirIno]);
  const next = new Uint8Array(data.length);
  next.set(data);
  for (let i = 0; i < SLOT; i += 1) next[slot * SLOT + i] = 0;
  let end = next.length;
  while (end >= SLOT && readU32(next, end - SLOT) === 0) end -= SLOT;
  setFileData(fs, fs.inodes[dirIno], next.subarray(0, Math.max(SLOT, end)), { forceBlock: true });
}

export function resolvePath(fs, path) {
  const parts = String(path).split('/').filter((p) => p && p !== '.');
  let cur = fs.root;
  let lastParent = null;
  let lastName = null;
  for (const part of parts) {
    if (fs.inodes[cur].mode !== MODE_DIR) throw new Error(`${path} passes through something that is not a directory.`);
    if (part === '..') {
      const up = dirEntries(fs, cur).find((entry) => entry.name === '..');
      cur = up ? up.inode : fs.root;
      continue;
    }
    const found = dirEntries(fs, cur).find((entry) => entry.name === part);
    if (!found) return { inode: 0, missing: true, parent: cur, name: part };
    lastParent = cur;
    lastName = part;
    cur = found.inode;
  }
  return { inode: cur, missing: false, parent: lastParent, name: lastName };
}

function parentDir(fs, path) {
  const text = String(path);
  const cut = text.lastIndexOf('/');
  const dirPath = cut <= 0 ? '/' : text.slice(0, cut);
  const name = text.slice(cut + 1);
  if (!name) throw new Error('Give the entry a name.');
  const resolved = resolvePath(fs, dirPath);
  if (resolved.missing) throw new Error(`No such directory: ${dirPath}`);
  if (fs.inodes[resolved.inode].mode !== MODE_DIR) throw new Error(`${dirPath} is not a directory.`);
  return { dir: resolved.inode, name };
}

export function fsMkdir(fs, path) {
  const { dir, name } = parentDir(fs, path);
  if (dirEntries(fs, dir).some((entry) => entry.name === name)) throw new Error(`${path} already exists.`);
  const ino = allocInode(fs);
  fs.inodes[ino] = { ...emptyInode(), mode: MODE_DIR, links: 2, ctime: fs.generation, mtime: fs.generation };
  try {
    const block = allocBlock(fs);
    fs.inodes[ino].direct[0] = block;
    writeEntryInto(fs, block, 0, ino, MODE_DIR, '.');
    writeEntryInto(fs, block, 1, dir, MODE_DIR, '..');
    fs.inodes[ino].size = 2 * SLOT;
    addEntry(fs, dir, ino, MODE_DIR, name);
  } catch (error) {
    for (const block of dataBlocks(fs, fs.inodes[ino])) freeBlock(fs, block);
    fs.inodes[ino] = emptyInode();
    throw error;
  }
  fs.inodes[dir].links += 1;
  return ino;
}

export function fsWrite(fs, path, bytes) {
  const { dir, name } = parentDir(fs, path);
  const existing = dirEntries(fs, dir).find((entry) => entry.name === name);
  if (existing) {
    if (fs.inodes[existing.inode].mode !== MODE_FILE) throw new Error(`${path} is a directory.`);
    setFileData(fs, fs.inodes[existing.inode], bytes);
    return existing.inode;
  }
  const ino = allocInode(fs);
  fs.inodes[ino] = { ...emptyInode(), mode: MODE_FILE, links: 1, ctime: fs.generation, mtime: fs.generation };
  try {
    setFileData(fs, fs.inodes[ino], bytes);
    addEntry(fs, dir, ino, MODE_FILE, name);
  } catch (error) {
    // a rejected write must not leave an allocated inode or blocks behind
    setFileData(fs, fs.inodes[ino], new Uint8Array(0));
    fs.inodes[ino] = emptyInode();
    throw error;
  }
  return ino;
}

export function fsRead(fs, path) {
  const resolved = resolvePath(fs, path);
  if (resolved.missing) throw new Error(`No such file: ${path}`);
  const ino = fs.inodes[resolved.inode];
  if (ino.mode !== MODE_FILE) throw new Error(`${path} is a directory.`);
  return readFile(fs, ino);
}

export function fsList(fs, path) {
  const resolved = resolvePath(fs, path);
  if (resolved.missing) throw new Error(`No such directory: ${path}`);
  const ino = fs.inodes[resolved.inode];
  if (ino.mode !== MODE_DIR) throw new Error(`${path} is not a directory.`);
  return dirEntries(fs, resolved.inode)
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .map((entry) => ({
      name: entry.name,
      type: fs.inodes[entry.inode].mode === MODE_DIR ? 'dir' : 'file',
      inode: entry.inode,
      size: fs.inodes[entry.inode].size,
      blocks: dataBlocks(fs, fs.inodes[entry.inode]).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fsStat(fs, path) {
  const resolved = resolvePath(fs, path);
  if (resolved.missing) throw new Error(`No such entry: ${path}`);
  const ino = fs.inodes[resolved.inode];
  return {
    inode: resolved.inode,
    type: ino.mode === MODE_DIR ? 'dir' : 'file',
    size: ino.size,
    links: ino.links,
    dataBlocks: dataBlocks(fs, ino).length,
    indirect: Boolean(ino.indirect),
    mtime: ino.mtime,
  };
}

export function fsUnlink(fs, path, { recursive = false } = {}) {
  const resolved = resolvePath(fs, path);
  if (resolved.missing) throw new Error(`No such entry: ${path}`);
  if (resolved.inode === fs.root) throw new Error('The root directory cannot be removed.');
  const ino = fs.inodes[resolved.inode];
  if (ino.mode === MODE_DIR) {
    const children = dirEntries(fs, resolved.inode).filter((entry) => entry.name !== '.' && entry.name !== '..');
    if (children.length && !recursive) throw new Error('That directory is not empty.');
    if (children.length) children.forEach((child) => fsUnlink(fs, `${path.replace(/\/$/, '')}/${child.name}`, { recursive: true }));
    for (const b of dataBlocks(fs, ino)) freeBlock(fs, b);
    if (ino.indirect) freeBlock(fs, ino.indirect);
    fs.inodes[resolved.inode] = emptyInode();
    fs.inodes[resolved.parent].links -= 1;
  } else {
    for (const b of dataBlocks(fs, ino)) freeBlock(fs, b);
    if (ino.indirect) freeBlock(fs, ino.indirect);
    fs.inodes[resolved.inode] = emptyInode();
  }
  const entries = dirEntries(fs, resolved.parent);
  const target = entries.find((entry) => entry.name === resolved.name);
  if (target) removeEntry(fs, resolved.parent, target.slot);
  return true;
}

export function fsRename(fs, from, to) {
  const resolved = resolvePath(fs, from);
  if (resolved.missing) throw new Error(`No such entry: ${from}`);
  const { dir: dirTo, name: nameTo } = parentDir(fs, to);
  if (resolvePath(fs, to).missing === false) throw new Error(`${to} already exists.`);
  const ino = fs.inodes[resolved.inode];
  if (ino.mode === MODE_DIR) {
    const inside = resolvePath(fs, to.replace(/\/[^/]*$/, '') || '/');
    let probe = inside.missing ? 0 : inside.inode;
    while (probe) {
      if (probe === resolved.inode) throw new Error('A directory cannot be moved inside itself.');
      const up = dirEntries(fs, probe).find((entry) => entry.name === '..');
      probe = up ? up.inode : 0;
      if (probe === fs.root) break;
    }
  }
  const entries = dirEntries(fs, resolved.parent);
  const target = entries.find((entry) => entry.name === resolved.name);
  if (target) removeEntry(fs, resolved.parent, target.slot);
  addEntry(fs, dirTo, resolved.inode, ino.mode, nameTo);
  return resolved.inode;
}

/** Everything reachable from the root, as sorted rows — the comparison surface for the tests. */
export function fsSnapshot(fs) {
  const rows = [];
  const walk = (dirIno, base) => {
    for (const entry of dirEntries(fs, dirIno)) {
      if (entry.name === '.' || entry.name === '..') continue;
      const path = base === '/' ? `/${entry.name}` : `${base}/${entry.name}`;
      const ino = fs.inodes[entry.inode];
      if (ino.mode === MODE_DIR) {
        rows.push(`${path}|dir|${ino.size}`);
        walk(entry.inode, path);
      } else {
        rows.push(`${path}|file|${ino.size}|${hashBytes(readFile(fs, ino))}`);
      }
    }
  };
  walk(fs.root, '/');
  return rows.sort();
}

export function fsSerialize(fs) {
  const total = fs.blockCount * fs.blockSize;
  const out = new Uint8Array(total);
  const header = new Uint8Array(fs.blockSize);
  for (let i = 0; i < MAGIC.length; i += 1) header[i] = MAGIC.charCodeAt(i);
  writeU32(header, 8, fs.blockSize);
  writeU32(header, 12, fs.blockCount);
  writeU32(header, 16, fs.inodeCount);
  writeU32(header, 20, fs.bitmapBlocks);
  writeU32(header, 24, fs.inodeBlocks);
  writeU32(header, 28, fs.dataStart);
  writeU32(header, 32, fs.root);
  writeU32(header, 36, fs.generation);
  out.set(header, 0);
  out.set(fs.bitmap.subarray(0, fs.blockCount), fs.blockSize);
  const inodeAt = (1 + fs.bitmapBlocks) * fs.blockSize;
  for (let i = 0; i < fs.inodeCount; i += 1) {
    const at = inodeAt + i * INODE_SIZE;
    const ino = fs.inodes[i];
    out[at] = ino.mode;
    out[at + 1] = ino.links;
    writeU32(out, at + 4, ino.size);
    for (let d = 0; d < DIRECT; d += 1) writeU32(out, at + 8 + d * 4, ino.direct[d]);
    writeU32(out, at + 40, ino.indirect);
    writeU32(out, at + 44, ino.ctime);
    writeU32(out, at + 48, ino.mtime);
  }
  for (let b = fs.dataStart; b < fs.blockCount; b += 1) out.set(fs.blocks[b], b * fs.blockSize);
  let h = 0x811c9dc5;
  for (let i = 0; i < total; i += 1) {
    h ^= out[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  writeU32(header, 40, h);
  out.set(header.subarray(40, 44), 40);
  return out;
}

export function fsDeserialize(bytes) {
  let magic = '';
  for (let i = 0; i < MAGIC.length; i += 1) magic += String.fromCharCode(bytes[i]);
  if (magic !== MAGIC) throw new Error('That image does not start with the filesystem superblock.');
  const blockSize = readU32(bytes, 8);
  const blockCount = readU32(bytes, 12);
  const inodeCount = readU32(bytes, 16);
  if (bytes.length !== blockCount * blockSize) throw new Error('The image is shorter than its superblock claims.');
  const stored = readU32(bytes, 40);
  const probe = new Uint8Array(bytes);
  writeU32(probe, 40, 0);
  let h = 0x811c9dc5;
  for (let i = 0; i < probe.length; i += 1) {
    h ^= probe[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  if (h !== stored) throw new Error('The image fails its own checksum — it was altered after writing.');
  const fs = {
    blockSize,
    blockCount,
    inodeCount,
    bitmapBlocks: readU32(bytes, 20),
    inodeBlocks: readU32(bytes, 24),
    dataStart: readU32(bytes, 28),
    root: readU32(bytes, 32),
    generation: readU32(bytes, 36),
    bitmap: new Uint8Array(blockCount),
    blocks: [],
    inodes: [],
  };
  fs.bitmap.set(bytes.subarray(blockSize, blockSize + blockCount));
  const inodeAt = (1 + fs.bitmapBlocks) * blockSize;
  for (let i = 0; i < inodeCount; i += 1) {
    const at = inodeAt + i * INODE_SIZE;
    const ino = emptyInode();
    ino.mode = bytes[at];
    ino.links = bytes[at + 1];
    ino.size = readU32(bytes, at + 4);
    for (let d = 0; d < DIRECT; d += 1) ino.direct[d] = readU32(bytes, at + 8 + d * 4);
    ino.indirect = readU32(bytes, at + 40);
    ino.ctime = readU32(bytes, at + 44);
    ino.mtime = readU32(bytes, at + 48);
    fs.inodes.push(ino);
  }
  fs.blocks = Array.from({ length: blockCount }, (_, b) => bytes.subarray(b * blockSize, (b + 1) * blockSize));
  return fs;
}

/**
 * The structural check. Every rule is a property of a healthy filesystem, so a
 * clean report means the invariants hold rather than that nothing was looked at.
 */
export function fsCheck(fs) {
  const problems = [];
  const stats = { usedBlocks: 0, freeBlocks: 0, referencedBlocks: 0, liveInodes: 0, orphans: 0, crossLinks: 0, directories: 0, files: 0, bytes: 0, largest: 0 };
  const refs = new Map();
  const addRef = (block, owner) => {
    if (block < 0 || block >= fs.blockCount) {
      problems.push(`Inode ${owner} points at block ${block}, which is outside the image.`);
      return;
    }
    if (!refs.has(block)) refs.set(block, []);
    refs.get(block).push(owner);
  };
  for (let b = 0; b < fs.blockCount; b += 1) if (fs.bitmap[b]) stats.usedBlocks += 1;
  stats.freeBlocks = fs.blockCount - stats.usedBlocks;
  for (let b = 0; b < fs.dataStart; b += 1) if (!fs.bitmap[b]) problems.push(`Reserved block ${b} is marked free.`);
  if (fs.inodes[fs.root]?.mode !== MODE_DIR) problems.push('The root inode is not a directory.');

  const entryCount = new Map();
  const visitedDirs = new Set();
  const queue = [fs.root];
  const inodeRefs = new Map();
  while (queue.length) {
    const dirIno = queue.shift();
    if (visitedDirs.has(dirIno)) {
      problems.push(`Directory inode ${dirIno} is reachable twice — a directory cycle.`);
      continue;
    }
    visitedDirs.add(dirIno);
    const ino = fs.inodes[dirIno];
    if (!ino) {
      problems.push(`Directory entry points at inode ${dirIno}, which does not exist.`);
      continue;
    }
    if (ino.size % SLOT !== 0) problems.push(`Directory inode ${dirIno} has size ${ino.size}, not a multiple of the ${SLOT}-byte slot.`);
    const entries = dirEntries(fs, dirIno);
    const names = new Set();
    for (const entry of entries) {
      if (!entry.name) problems.push(`Directory inode ${dirIno} holds an entry with no name.`);
      if (names.has(entry.name)) problems.push(`Directory inode ${dirIno} holds “${entry.name}” twice.`);
      names.add(entry.name);
      const child = fs.inodes[entry.inode];
      if (!child || !child.mode) {
        problems.push(`Directory inode ${dirIno} references unallocated inode ${entry.inode}.`);
        continue;
      }
      const actual = child.mode === MODE_DIR ? MODE_DIR : MODE_FILE;
      if (actual !== entry.type) problems.push(`Entry “${entry.name}” is marked as ${entry.type === MODE_DIR ? 'a directory' : 'a file'} but inode ${entry.inode} is the other.`);
      entryCount.set(entry.inode, (entryCount.get(entry.inode) ?? 0) + 1);
    }
    if (dirIno === fs.root) {
      if (!names.has('.') || !names.has('..')) problems.push('The root directory is missing its self or parent entry.');
    }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const child = fs.inodes[entry.inode];
      if (child?.mode === MODE_DIR) queue.push(entry.inode);
    }
  }
  for (let i = 0; i < fs.inodeCount; i += 1) {
    const ino = fs.inodes[i];
    if (!ino.mode) continue;
    stats.liveInodes += 1;
    if (ino.mode === MODE_DIR) stats.directories += 1;
    else {
      stats.files += 1;
      stats.bytes += ino.size;
      stats.largest = Math.max(stats.largest, ino.size);
    }
    const blocks = dataBlocks(fs, ino);
    for (const block of blocks) addRef(block, i);
    if (ino.indirect) addRef(ino.indirect, i);
    const entries = entryCount.get(i) ?? 0;
    if (entries !== ino.links) problems.push(`Inode ${i} has ${ino.links} link(s) but ${entries} directory entry/entries.`);
    if (i !== fs.root && entries === 0) {
      stats.orphans += 1;
      problems.push(`Inode ${i} is allocated but nothing points at it.`);
    }
    const capacity = blocks.length * fs.blockSize;
    if (ino.size > capacity) problems.push(`Inode ${i} claims ${ino.size} bytes but holds ${blocks.length} block(s).`);
    if (ino.size <= (blocks.length - 1) * fs.blockSize) problems.push(`Inode ${i} holds more blocks than its size needs.`);
    if (ino.indirect) {
      const ind = fs.blocks[ino.indirect];
      const used = ino.direct.filter(Boolean).length;
      const expected = Math.max(0, blocks.length - used);
      for (let k = 0; k < perBlock(fs); k += 1) {
        if (k >= expected && readU32(ind, k * 4)) problems.push(`Indirect block of inode ${i} has an entry past the end of the file.`);
      }
    }
  }
  for (const [block, owners] of refs) {
    stats.referencedBlocks += 1;
    if (owners.length > 1) {
      stats.crossLinks += 1;
      problems.push(`Block ${block} is referenced by ${owners.length} owners (${owners.join(', ')}) — a cross-link.`);
    }
    if (block >= fs.dataStart && !fs.bitmap[block]) problems.push(`Block ${block} is used by inode ${owners[0]} but the bitmap marks it free.`);
  }
  for (let b = fs.dataStart; b < fs.blockCount; b += 1) {
    if (fs.bitmap[b] && !refs.has(b)) problems.push(`Block ${b} is marked used but nothing references it.`);
  }
  return { ok: problems.length === 0, problems: problems.slice(0, 24), totalProblems: problems.length, stats };
}

/**
 * Model-based differential test: a random sequence of operations runs against the
 * filesystem and against a plain Map, and the two are compared after every step.
 */
export function runWorkload({ seed = 7, steps = 120, blockSize = BLOCK_SIZE } = {}) {
  let state = (seed >>> 0) || 1;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fs = createImage({ blocks: 320, inodes: 96, blockSize });
  const model = new Map();
  const dirs = ['/'];
  const pick = () => ['/', ...dirs][Math.floor(random() * (dirs.length + 1))];
  const journal = [];
  const log = [];
  let mismatches = 0;
  let firstMismatch = null;
  let failures = 0;

  const modelRows = () => {
    const rows = [];
    for (const [path, entry] of model) {
      if (entry.type === 'dir') rows.push(`${path}|dir|${entry.size}`);
      else rows.push(`${path}|file|${entry.bytes.length}|${hashBytes(entry.bytes)}`);
    }
    return rows.sort();
  };
  const compare = (label) => {
    const snap = fsSnapshot(fs);
    const ref = modelRows();
    if (JSON.stringify(snap) !== JSON.stringify(ref)) {
      mismatches += 1;
      if (!firstMismatch) firstMismatch = { label, fs: snap, model: ref };
    }
  };
  const attemptOp = (label, run) => {
    try {
      run();
      journal.push({ label, ok: true });
    } catch (error) {
      failures += 1;
      journal.push({ label, ok: false, error: error.message });
    }
  };

  for (let step = 0; step < steps; step += 1) {
    const dir = pick();
    const name = `n${Math.floor(random() * 400)}`;
    const path = dir === '/' ? `/${name}` : `${dir}/${name}`;
    const roll = random();
    if (roll < 0.5) {
      const size = Math.floor(random() * 4000);
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) bytes[i] = Math.floor(random() * 256);
      attemptOp(`write ${path} (${size}b)`, () => {
        fsWrite(fs, path, bytes);
        model.set(path, { type: 'file', bytes });
      });
    } else if (roll < 0.65) {
      attemptOp(`mkdir ${path}`, () => {
        fsMkdir(fs, path);
        model.set(path, { type: 'dir', size: 2 * SLOT });
        dirs.push(path);
      });
    } else if (roll < 0.8) {
      // deleting something that actually exists is what makes the comparison meaningful
      const keys = [...model.keys()];
      const victim = keys.length && random() < 0.75 ? keys[Math.floor(random() * keys.length)] : path;
      attemptOp(`unlink ${victim}`, () => {
        fsUnlink(fs, victim, { recursive: true });
        for (const key of [...model.keys()]) if (key === victim || key.startsWith(`${victim}/`)) model.delete(key);
      });
    } else if (roll < 0.9) {
      const to = `${pick()}/r${Math.floor(random() * 200)}`.replace('//', '/');
      attemptOp(`rename ${path} → ${to}`, () => {
        fsRename(fs, path, to);
        const entry = model.get(path);
        model.delete(path);
        model.set(to, entry);
      });
    } else {
      attemptOp(`read ${path}`, () => {
        const entry = model.get(path);
        if (entry?.type === 'file') {
          const bytes = fsRead(fs, path);
          if (bytes.length !== entry.bytes.length || hashBytes(bytes) !== hashBytes(entry.bytes)) throw new Error('content differs from the model');
        } else if (entry?.type === 'dir') {
          fsList(fs, path);
        } else {
          try {
            fsRead(fs, path);
            throw new Error('a missing file was readable');
          } catch (error) {
            if (error.message === 'a missing file was readable') throw error;
          }
        }
      });
    }
    compare(`after ${step + 1}`);
  }

  const check1 = fsCheck(fs);
  const image = fsSerialize(fs);
  const reopened = fsDeserialize(image);
  const before = fsSnapshot(fs);
  const after = fsSnapshot(reopened);
  const check2 = fsCheck(reopened);
  log.push({ op: 'serialise', bytes: image.length });

  return {
    steps,
    operationsApplied: journal.length,
    rejected: failures,
    mismatches,
    firstMismatch,
    fs,
    check: check1,
    imageBytes: image.length,
    roundTrip: {
      identical: JSON.stringify(before) === JSON.stringify(after),
      filesCompared: before.length,
      checkClean: check2.ok,
      problems: check2.problems,
    },
    afterReopen: check2,
    journal: journal.slice(0, 40),
  };
}