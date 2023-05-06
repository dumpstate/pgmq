import { DBAction, pure } from "@dumpstate/dbaction/lib/PG"
import { Bongo, Document } from "@dumpstate/bongojs"
import { forever } from "async"
import { PoolClient } from "pg"
import { Queue } from "./Queue"
import { QueueType } from "./model"

export abstract class Worker {
	public constructor(private readonly queue: Queue) {}

	abstract process(task: Document<QueueType>): Promise<any>

	public run(bongo: Bongo) {
		forever(
			async () =>
				this.queue
					.dequeue()
					.flatMap((task) => {
						if (task === null) {
							return pure(null)
						}

						return new DBAction((conn: PoolClient) =>
							this.process(task)
								.then(() =>
									this.queue.moveToDone(task).action(conn)
								)
								.catch((err) => {
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
							return new Promise((resolve) =>
								setTimeout(resolve, 200)
							)
						} else {
							return null
						}
					}),
			(err) => {
				console.error(err)
				process.exit(1)
			}
		)
	}
}
