import { Schema } from "@dumpstate/bongojs"

export const QueueSchema = {
	name: "pgmq_queue",
	schema: {
		name: { type: "string" },
		createdAt: { type: "timestamp" },
		visibleAt: { type: "timestamp" },
		attempts: { type: "int32" },
		payload: { values: { type: "string" } },
	},
} as const
export type QueueType = Schema<typeof QueueSchema>

export const DoneSchema = {
	name: "pgmq_done",
	schema: {
		name: { type: "string" },
		createdAt: { type: "timestamp" },
		payload: { values: { type: "string" } },
	},
} as const
export type DoneType = Schema<typeof DoneSchema>

export const DlqSchema = {
	name: "pgmq_dlq",
	schema: {
		name: { type: "string" },
		createdAt: { type: "timestamp" },
		error: { type: "string" },
		payload: { values: { type: "string" } },
	},
} as const
export type DlqType = Schema<typeof DlqSchema>
