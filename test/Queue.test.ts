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

	await t.test("return to queue with backoff", async (t) => {
		const ts = new Date()
		const backoffBase = 2
		const q = await Queue.create(bongo, "bar", () => ts)

		await queue.enqueue({ bar: "bar" }).run(bongo.tr)
		let task = await queue.dequeue().run(bongo.tr)
		task = await q.returnToQueue(task as any, backoffBase).run(bongo.tr)
		t.match(new Date(task.visibleAt$ as any).getTime(), ts.getTime() + 1000)

		await q.purge().run(bongo.tr)
	})
})
