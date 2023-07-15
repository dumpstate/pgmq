import assert from "node:assert/strict"
import { Bongo } from "@dumpstate/bongojs"
import { Queue } from "../src"

describe("Queue", () => {
	const bongo = new Bongo()
	let queue: Queue

	before(async () => {
		await bongo.migrate()
		queue = await Queue.create(bongo, "foo")
	})

	afterEach(async () => {
		await queue.purge().transact(bongo.tr)
	})

	after(async () => {
		await bongo.drop()
		await bongo.close()
	})

	it("should enqueue then dequeue", async () => {
		const task = { foo: "enqueue then dequeue" }

		await queue.enqueue(task).transact(bongo.tr)

		await queue
			.dequeue()
			.map((found) => {
				assert.deepEqual(found?.payload$, task)
			})
			.transact(bongo.tr)
	})

	it("dequeue returns null if visibility timeout not yet expired", async () => {
		const task = { foo: "bar" }

		await queue
			.enqueue(task, new Date(new Date().getTime() + 10000))
			.transact(bongo.tr)

		const found = await queue.dequeue().transact(bongo.tr)
		assert.equal(found, null)
	})

	it("should return to queue with backoff", async () => {
		const ts = new Date()
		const backoffBase = 2
		const q = await Queue.create(bongo, "bar", () => ts)

		await queue.enqueue({ bar: "bar" }).run(bongo.tr)
		let task = await queue.dequeue().run(bongo.tr)
		task = await q.returnToQueue(task as any, backoffBase).run(bongo.tr)
		assert.equal(
			new Date(task.visibleAt$ as any).getTime(),
			ts.getTime() + 1000,
		)

		await q.purge().run(bongo.tr)
	})
})
