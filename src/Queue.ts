import { Bongo, Collection, Document } from "@dumpstate/bongojs"
import { DBAction, sequence } from "@dumpstate/dbaction/lib/PG"
import {
	QueueSchema,
	QueueType,
	DlqSchema,
	DlqType,
	DoneSchema,
	DoneType,
} from "./model"

function ts(): Date {
	return new Date()
}

export class Queue {
	private constructor(
		public readonly name: string,
		public readonly queue: Collection<QueueType>,
		private readonly dlq: Collection<DlqType>,
		private readonly done: Collection<DoneType>,
		private readonly now: () => Date = ts,
	) {}

	public enqueue(
		task: Record<string, string>,
		visibleAt: Date | null = null,
	): DBAction<Document<QueueType>> {
		const now = this.now()

		return this.queue.create({
			name: this.name,
			createdAt: now,
			visibleAt: visibleAt || now,
			attempts: 0,
			payload: task,
		})
	}

	public dequeue(): DBAction<Document<QueueType> | null> {
		return this.queue
			.find(
				{
					name: this.name,
					visibleAt: { $lte: this.now() },
				},
				{ forUpdate: true, limit: 1 },
			)
			.map((items) => {
				if (items.length === 0) {
					return null
				}

				return items[0] as Document<QueueType>
			})
	}

	public attempt(task: Document<QueueType>): DBAction<Document<QueueType>> {
		task.attempts = task.attempts$ + 1
		return this.queue.save(task)
	}

	public returnToQueue(
		task: Document<QueueType>,
		backoffBase: number,
	): DBAction<Document<QueueType>> {
		if (backoffBase >= 0) {
			task.visibleAt = new Date(
				this.now().getTime() +
					Math.pow(backoffBase, task.attempts$) * 1000,
			)
		}

		return this.queue.save(task)
	}

	public moveToDlq(
		task: Document<QueueType>,
		error: Error | string,
	): DBAction<Document<QueueType>> {
		return sequence(
			this.queue.deleteById(task.id),
			this.dlq.create({
				name: this.name,
				createdAt: this.now(),
				error: typeof error === "string" ? error : error.toString(),
				payload: task.payload$,
			}),
		).map((_) => task)
	}

	public moveToDone(
		task: Document<QueueType>,
	): DBAction<Document<QueueType>> {
		return sequence(
			this.queue.deleteById(task.id),
			this.done.create({
				name: this.name,
				createdAt: this.now(),
				payload: task.payload$,
			}),
		).map((_) => task)
	}

	public purge(): DBAction<[number, number, number]> {
		return sequence(this.queue.drop(), this.dlq.drop(), this.done.drop())
	}

	public size(): DBAction<number> {
		return this.queue.count({})
	}

	public dlqSize(): DBAction<number> {
		return this.dlq.count({})
	}

	public doneSize(): DBAction<number> {
		return this.done.count({})
	}

	public static async create(
		bongo: Bongo,
		name: string,
		tsFactory: () => Date = ts,
	): Promise<Queue> {
		const queue = bongo.collection(QueueSchema)
		const dlq = bongo.collection(DlqSchema)
		const done = bongo.collection(DoneSchema)

		await sequence(
			queue.ensurePartition(),
			dlq.ensurePartition(),
			done.ensurePartition(),
		).transact(bongo.tr)

		return new Queue(name, queue, dlq, done, tsFactory)
	}
}
