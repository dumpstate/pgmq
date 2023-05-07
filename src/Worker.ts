import { DBAction, pure } from "@dumpstate/dbaction/lib/PG"
import { Logger, newLogger } from "@dumpstate/bongojs/lib/logger"
import { Bongo, Document } from "@dumpstate/bongojs"
import { forever } from "async"
import { PoolClient } from "pg"
import { Queue } from "./Queue"
import { QueueType } from "./model"

export abstract class Worker {
	private readonly logger: Logger

	public constructor(private readonly queue: Queue, logger?: Logger) {
		if (logger) {
			this.logger = logger
		} else {
			this.logger = newLogger({ name: "pgmq", level: "info" })
		}
	}

	abstract process(task: Document<QueueType>): Promise<any>

	public run(bongo: Bongo) {
		this.logger.info(`Starting worker loop: ${this.queue.name}`)
		let count = 0

		forever(
			async () => {
				this.logger.info(`Worker loop ${count}`)
				count += 1
				return this.queue
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
					.then((res) => {
						if (res === null) {
							this.logger.info("Queue is empty, waiting")
							return new Promise((resolve) =>
								setTimeout(resolve, 1000)
							)
						} else {
							return null
						}
					})
			},
			(err) => {
				console.error(err)
				process.exit(1)
			}
		)
	}
}
