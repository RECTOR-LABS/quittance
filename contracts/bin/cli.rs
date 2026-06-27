//! `odra-cli` entry point for deploying and interacting with `ServicerVault`.
//!
//! This binary drives the creds-gated Wasm deploy path (PLAN Task 1.5) and is
//! NOT exercised by the OdraVM test suite. It must still compile, so it is kept
//! in sync with the live `ServicerVault` module surface.

use odra::host::{HostEnv, NoArgs};
use odra_cli::{deploy::DeployScript, DeployedContractsContainer, DeployerExt, OdraCli};
use quittance_contracts::servicer_vault::ServicerVault;

/// Deploys the `ServicerVault` and registers it in the container.
pub struct ServicerVaultDeployScript;

impl DeployScript for ServicerVaultDeployScript {
    fn deploy(
        &self,
        env: &HostEnv,
        container: &mut DeployedContractsContainer,
    ) -> Result<(), odra_cli::deploy::Error> {
        let _vault = ServicerVault::load_or_deploy(
            env,
            NoArgs,
            container,
            350_000_000_000, // gas limit; tune for the target network
        )?;

        Ok(())
    }
}

/// Main function to run the CLI tool.
pub fn main() {
    // Surface the underlying deploy error that odra-casper-livenet-env logs via
    // the `log` facade (otherwise masked as the opaque ContractDeploymentError).
    env_logger::init();
    OdraCli::new()
        .about("CLI tool for the ServicerVault smart contract")
        .deploy(ServicerVaultDeployScript)
        .contract::<ServicerVault>()
        .build()
        .run();
}
