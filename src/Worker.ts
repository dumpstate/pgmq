import { DBAction, pure } from "@dumpstate/dbaction/lib/PG"
import { Logger, newLogger } from "@dumpstate/bongojs/lib/logger"
import { Bongo, Document } from "@dumpstate/bongojs"
import { PoolClient } from "pg"
import { Queue } from "./Queue"
import { QueueType } from "./model"

const MAX_ATTEMPTS = 3
const TIMEOUT_EMPTY = 1000
const TIMEOUT_NON_EMPTY = 50
const BACKOFF_BASE = 1

export interface WorkerOpts {
	maxAttempts?: number
	timeoutEmpty?: number
	timeoutNonEmpty?: number
	backoffBase?: number
	logger?: Logger
}

export abstract class Worker {
	protected readonly logger: Logger

	private readonly maxAttempts: number
	private readonly timeoutEmpty: number
	private readonly timeoutNonEmpty: number
	private readonly backoffBase: number

	public constructor(
		private readonly queue: Queue,
		opts: WorkerOpts,
	) {
		if (opts.logger) {
			this.logger = opts.logger
		} else {
			this.logger = newLogger({ name: "pgmq", level: "info" })
		}

		this.maxAttempts = opts.maxAttempts || MAX_ATTEMPTS
		this.timeoutEmpty = opts.timeoutEmpty || TIMEOUT_EMPTY
		this.timeoutNonEmpty = opts.timeoutNonEmpty || TIMEOUT_NON_EMPTY
		this.backoffBase = opts.backoffBase || BACKOFF_BASE
	}

	abstract process(task: Document<QueueType>): Promise<any>

	public async step(bongo: Bongo): Promise<Document<QueueType> | null> {
		return this.queue
			.dequeue()
			.flatMap((task) => {
				if (task === null) {
					return pure(null)
				}

				return new DBAction((conn: PoolClient) =>
					this.queue
						.attempt(task)
						.action(conn)
						.then((task) =>
							this.process(task)
								.then(() => {
									this.logger.info(
										`Moving task ${task.id} to DONE`,
									)
									return this.queue
										.moveToDone(task)
										.action(conn)
								})
								.catch((err) => {
									this.logger.error(
										`err when processing task ${task.id}`,
										err,
									)
									if (task.attempts$ >= this.maxAttempts) {
										return this.queue
											.moveToDlq(task, err)
											.action(conn)
									} else {
										return this.queue
											.returnToQueue(
												task,
												this.backoffBase,
											)
											.action(conn)
									}
								}),
						),
				)
			})
			.transact(bongo.tr)
	}

	public async run(bongo: Bongo) {
		this.logger.info(`Starting worker loop: ${this.queue.name}`)

		try {
			while (true) {
				const task = await this.step(bongo)

				await new Promise((resolve) =>
					setTimeout(
						resolve,
						task === null
							? this.timeoutEmpty
							: this.timeoutNonEmpty,
					),
				)
			}
		} catch (err) {
			this.logger.error(`err when running the worker`, err)
			process.exit(1)
		}
	}
}
