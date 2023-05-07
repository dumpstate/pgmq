import { Bongo } from "@dumpstate/bongojs"
import { test } from "tap"
import { Queue } from "../src"

test("Queue", async (t) => {
	const bongo = new Bongo()
	let queue: Queue

	t.before(async () => {
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
})
