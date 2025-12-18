/**
 * Task management tools
 *
 * Tools for managing tasks in vault task lists with automatic capture and aggregation.
 */

export { getTasksByDate } from './getTasksByDate.js';
export { addTask } from './addTask.js';
export { completeTask } from './completeTask.js';

export type { GetTasksByDateArgs, GetTasksByDateResult } from './getTasksByDate.js';
export type { AddTaskArgs, AddTaskResult } from './addTask.js';
export type { CompleteTaskArgs, CompleteTaskResult } from './completeTask.js';
