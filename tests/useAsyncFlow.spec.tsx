import { renderHook, act } from '@testing-library/react'
import { useAsyncFlow } from '../src/useAsyncFlow'

jest.useFakeTimers()

test('parallel + timeout + retry + cancel', async () => {
	const asyncTask = jest.fn(() => Promise.resolve(42))

	const { result } = renderHook(() => useAsyncFlow({
		auto: false,
		run: async ({ spawn }) => {
			const a = await spawn.parallel([asyncTask, asyncTask])
			return a
		}
	}))

	let value: any
	await act(async () => {
		value = await result.current.run()
	})
	expect(value).toEqual([42, 42])
})
