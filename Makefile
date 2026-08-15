# Regenerate, build and test the UARP SDKs.
#
#   make generate            regenerate every target
#   make generate T=rust     regenerate one target
#   make test                build and test all five packages
#   make test-rust           just one

.DEFAULT_GOAL := help
.PHONY: help generate stats check check-docs test contract smoke smoke-dry smoke-live update-golden test-generator test-typescript test-rust test-swift test-kotlin test-ada clean

T ?=

help: ## Show this help
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk -F':.*?## ' '{printf "  %-18s %s\n", $$1, $$2}'

generate: ## Regenerate SDKs (T=<target> for one)
	@node generator/src/index.ts $(T)

stats: ## Report what the vendored spec contains
	@node generator/src/index.ts --stats

check: ## Fail if the checked-in output is stale
	@node generator/src/index.ts --check

check-docs: ## Compile the code samples in the documentation
	@node scripts/check-docs.ts

test: check-docs test-generator test-typescript test-rust test-swift test-kotlin test-ada ## Build and test everything

contract: ## Prove the five SDKs put the same bytes on the wire
	@./contract/run.sh

smoke: ## Sweep a live server and report where it diverges from the spec (needs UARP_API_KEY)
	@node smoke/src/run.ts $(ARGS)
	@node smoke/src/report.ts
	@node smoke/src/html.ts

smoke-dry: ## Show what the live sweep would call, without sending anything
	@node smoke/src/run.ts --dry-run

smoke-live: ## Run one scenario through all five SDKs against a live server
	@./smoke/live/run.sh

test-generator: ## Type-check and test the generator itself
	@cd generator && npm install --silent && npm run typecheck && npm test

update-golden: ## Refresh the generator's golden files, then review the diff
	@cd generator && npm run test:update-golden

test-typescript: ## Build and test the TypeScript SDK
	@cd packages/typescript && npm install --silent && npm test

test-rust: ## Build and test the Rust SDK
	@cd packages/rust && cargo test --all-features

test-swift: ## Build and test the Swift SDK
	@cd packages/swift && swift test

test-kotlin: ## Build and test the Kotlin SDK
	@cd packages/kotlin && ./gradlew :uarp-sdk:test

test-ada: ## Build and test the Ada SDK against the mock server
	@cd packages/ada && ./tests/run-tests.sh

clean: ## Remove build output from every package
	@rm -rf packages/typescript/dist packages/typescript/node_modules
	@rm -rf packages/rust/target
	@rm -rf packages/swift/.build
	@rm -rf packages/kotlin/build packages/kotlin/uarp-sdk/build packages/kotlin/.gradle
	@rm -rf packages/ada/obj packages/ada/lib packages/ada/tests/obj packages/ada/tests/bin
