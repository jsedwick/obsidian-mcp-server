/**
 * Memory tools exports
 *
 * This module exports memory continuity tools:
 * - get_memory_base: Retrieve vault index from memory file
 * - generate_vault_index: Generate procedural file index for memory
 * - update_user_reference: Update structured user context information
 * - append_to_accumulator: Append content to running accumulator logs
 */

export { getMemoryBase } from './getMemoryBase.js';
export type { GetMemoryBaseArgs, GetMemoryBaseResult } from './getMemoryBase.js';

export { generateVaultIndex, writeVaultIndex } from './generateVaultIndex.js';
export type { GenerateVaultIndexArgs, GenerateVaultIndexResult } from './generateVaultIndex.js';

export { updateUserReference } from './updateUserReference.js';
export type { UpdateUserReferenceArgs, UpdateUserReferenceResult } from './updateUserReference.js';

export { appendToAccumulator } from './appendToAccumulator.js';
export type { AppendToAccumulatorArgs, AppendToAccumulatorResult } from './appendToAccumulator.js';
