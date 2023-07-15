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
		assert.equal(await queue.size().run(bongo.tr), 1)

		await queue
			.dequeue()
			.map((found) => {
				assert.deepEqual(found?.payload$, task)
				return found
			})
			.flatMap((taskFromQueue) => queue.moveToDone(taskFromQueue))
			.transact(bongo.tr)
		assert.equal(await queue.size().run(bongo.tr), 0)
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

		await q.enqueue({ bar: "bar" }).run(bongo.tr)
		await q
			.dequeue()
			.flatMap((task) =>
				q.returnToQueue(task as any, backoffBase).map((res) => {
					assert.equal(
						new Date(res.visibleAt$).getTime(),
						ts.getTime() + 1000,
					)
					return res
				}),
			)
			.transact(bongo.tr)

		await q.purge().run(bongo.tr)
	})

	it("should move to DLQ if too many attempts", async () => {
		const task = await queue.enqueue({ foo: "foo" }).transact(bongo.tr)
		assert.equal(await queue.size().run(bongo.tr), 1)
		assert.equal(await queue.dlqSize().run(bongo.tr), 0)

		await queue.moveToDlq(task, "oops").transact(bongo.tr)
		assert.equal(await queue.size().run(bongo.tr), 0)
		assert.equal(await queue.dlqSize().run(bongo.tr), 1)
	})
})
