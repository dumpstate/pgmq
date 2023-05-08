import { Bongo } from "@dumpstate/bongojs"
import { test } from "tap"
import { Queue } from "../src"

test("Queue", async (t) => {
	const bongo = new Bongo()
	let queue: Queue

	t.before(async () => {
		await bongo.migrate()
		queue = await Queue.create(bongo, "foo")
	})

	t.afterEach(async () => {
		await queue.purge().transact(bongo.tr)
	})

	await t.test("enqueue then dequeue", async (t) => {
		const task = { foo: "enqueue then dequeue" }

		await queue.enqueue(task).transact(bongo.tr)

		await queue
			.dequeue()
			.map((found) => {
				t.match(found?.payload$, task)
			})
			.transact(bongo.tr)
	})

	await t.test(
		"dequeue returns null if visibility timeout not yet expired",
		async (t) => {
			const task = { foo: "bar" }

			await queue
				.enqueue(task, new Date(new Date().getTime() + 10000))
				.transact(bongo.tr)

			const found = await queue.dequeue().transact(bongo.tr)
			t.match(found, null)
		}
	)
})
