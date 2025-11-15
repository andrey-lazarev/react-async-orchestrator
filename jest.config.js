module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'jsdom',
	transform: {
		'^.+\\.tsx?$': 'ts-jest'
	},
	testMatch: ['**/tests/**/*.spec.ts', '**/tests/**/*.spec.tsx'],
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
}
