import assert from "node:assert/strict"
import { Bongo } from "@dumpstate/bongojs"
import { Worker } from "../src/Worker"
import { Queue } from "../src/Queue"

class ValidWorker extends Worker {
	public process() {
		return Promise.resolve()
	}
}

class FaultyWorker extends Worker {
	public process() {
		return Promise.reject(new Error("foo"))
	}
}

describe("ValidWorker", () => {
	const bongo = new Bongo()
	let queue: Queue
	let worker: Worker

	before(async () => {
		await bongo.migrate()
		;(queue = await Queue.create(bongo, "foo")),
			(worker = new ValidWorker(queue, {}))
	})

	after(async () => {
		await queue.purge().transact(bongo.tr)
		await bongo.drop()
		await bongo.close()
	})

	it("should move message to done on process", async () => {
		await queue.enqueue({ foo: "foo" }).transact(bongo.tr)

		await worker.step(bongo)
		assert.equal(await queue.size().run(bongo.tr), 0)
		assert.equal(await queue.dlqSize().run(bongo.tr), 0)
		assert.equal(await queue.doneSize().run(bongo.tr), 1)
	})
})

describe("FaultyWorker", () => {
	const bongo = new Bongo()
	let queue: Queue
	let worker: Worker

	before(async () => {
		await bongo.migrate()
		;(queue = await Queue.create(bongo, "foo")),
			(worker = new FaultyWorker(queue, {
				maxAttempts: 2,
				backoffBase: -1,
			}))
	})

	after(async () => {
		await queue.purge().transact(bongo.tr)
		await bongo.drop()
		await bongo.close()
	})

	it("should move message to dlq on process", async () => {
		await queue.enqueue({ foo: "foo" }).transact(bongo.tr)

		await worker.step(bongo)
		assert.equal(
			await queue.size().run(bongo.tr),
			1,
			"invalid queue size, attempt 1",
		)
		assert.equal(
			await queue.dlqSize().run(bongo.tr),
			0,
			"invalid dlq size, attempt 1",
		)
		assert.equal(
			await queue.doneSize().run(bongo.tr),
			0,
			"invalid done size, attempt 1",
		)

		await worker.step(bongo)
		assert.equal(
			await queue.size().run(bongo.tr),
			0,
			"invalid queue size, attempt 2",
		)
		assert.equal(
			await queue.dlqSize().run(bongo.tr),
			1,
			"invalid dlq size, attempt 2",
		)
		assert.equal(
			await queue.doneSize().run(bongo.tr),
			0,
			"invalid done size, attempt 2",
		)
	})
})
