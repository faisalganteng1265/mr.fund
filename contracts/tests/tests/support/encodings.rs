//! Independent sandbox request encodings; never a product signer or Guardian implementation.
use anyhow::{Context, Result, bail, ensure};

pub struct Call {
    pub receiver: String,
    pub method: &'static str,
    pub args: Vec<u8>,
    pub deposit: u128,
}

pub fn repay(token: &str, lending: &str, amount: u128, version: &str, extra: u8) -> Result<Call> {
    ensure!(extra <= 38, "Invalid extra decimals");
    let msg = match version {
        "0.16.2" => "\"OnlyRepay\"".to_owned(),
        "0.11.0" => {
            let internal = amount
                .checked_mul(10u128.pow(extra.into()))
                .context("Internal amount overflow")?;
            format!(
                "{{\"Execute\":{{\"actions\":[{{\"Repay\":{{\"token_id\":{},\"max_amount\":\"{internal}\"}}}}]}}}}",
                serde_json::to_string(token)?
            )
        }
        _ => bail!("Unsupported lending version"),
    };
    transfer_call(token, lending, amount, &msg)
}

pub fn transfer_call(token: &str, receiver: &str, amount: u128, msg: &str) -> Result<Call> {
    ensure!(amount > 0, "Positive amount required");
    Ok(Call {
        receiver: token.into(),
        method: "ft_transfer_call",
        args: format!(
            "{{\"receiver_id\":{},\"amount\":\"{amount}\",\"msg\":{}}}",
            serde_json::to_string(receiver)?,
            serde_json::to_string(msg)?
        )
        .into_bytes(),
        deposit: 1,
    })
}

pub fn transfer(token: &str, receiver: &str, amount: u128) -> Result<Call> {
    ensure!(amount > 0, "Positive amount required");
    Ok(Call {
        receiver: token.into(),
        method: "ft_transfer",
        args: format!(
            "{{\"receiver_id\":{},\"amount\":\"{amount}\"}}",
            serde_json::to_string(receiver)?
        )
        .into_bytes(),
        deposit: 1,
    })
}

pub fn storage(token: &str, account: &str, deposit: u128) -> Result<Call> {
    ensure!(deposit > 0, "Positive deposit required");
    Ok(Call {
        receiver: token.into(),
        method: "storage_deposit",
        args: format!(
            "{{\"account_id\":{},\"registration_only\":true}}",
            serde_json::to_string(account)?
        )
        .into_bytes(),
        deposit,
    })
}
