import { DBAction, pure } from "@dumpstate/dbaction/lib/PG"
import { Logger, newLogger } from "@dumpstate/bongojs/lib/logger"
import { Bongo, Document } from "@dumpstate/bongojs"
import { PoolClient } from "pg"
import { Queue } from "./Queue"
import { QueueType } from "./model"

export abstract class Worker {
	protected readonly logger: Logger

	public constructor(private readonly queue: Queue, logger?: Logger) {
		if (logger) {
			this.logger = logger
		} else {
			this.logger = newLogger({ name: "pgmq", level: "info" })
		}
	}

	abstract process(task: Document<QueueType>): Promise<any>

	public async run(bongo: Bongo) {
		this.logger.info(`Starting worker loop: ${this.queue.name}`)
		let count = 0

		try {
			while (true) {
				count += 1
				this.logger.info(`Worker loop ${count}`)
				const task = await this.queue
					.dequeue()
					.flatMap((task) => {
						if (task === null) {
							return pure(null)
						}

						return new DBAction((conn: PoolClient) =>
							this.process(task)
								.then(() => {
									this.logger.info(
										`Moving task ${task.id} to DONE`
									)
									return this.queue
										.moveToDone(task)
										.action(conn)
								})
								.catch((err) => {
									this.logger.error(
										`err when processing task ${task.id}`,
										err
									)
									if (task.attempts$ > 3) {
										return this.queue
											.moveToDlq(task, err)
											.action(conn)
									} else {
										return this.queue
											.returnToQueue(task)
											.action(conn)
									}
								})
						)
					})
					.transact(bongo.tr)

				await new Promise((resolve) =>
					setTimeout(resolve, task === null ? 1000 : 100)
				)
			}
		} catch (err) {
			this.logger.error(`err when running the worker`, err)
			process.exit(1)
		}
	}
}
