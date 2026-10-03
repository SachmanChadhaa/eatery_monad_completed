// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @title CINR (demo rupee)
/// @notice Valueless demo token for the buildathon (spec D3, DemoAdapter). 2 decimals, so 1 unit = 1 paisa.
///         Students sign EIP-2612 permits and the backend pulls payment, so student wallets never need gas.
///         The faucet is relayed by the backend: anyone may call it for any address, once per cooldown.
contract CINR is ERC20, ERC20Permit {
    uint256 public constant FAUCET_AMOUNT = 500_00; // 500 cINR
    uint256 public constant FAUCET_COOLDOWN = 1 days;

    mapping(address => uint256) public lastFaucet;

    event Faucet(address indexed to, uint256 amount);

    error FaucetCooldown(uint256 nextAt);

    constructor() ERC20("Canteen Demo Rupee", "cINR") ERC20Permit("Canteen Demo Rupee") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function faucet(address to) external {
        uint256 last = lastFaucet[to];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucet[to] = block.timestamp;
        _mint(to, FAUCET_AMOUNT);
        emit Faucet(to, FAUCET_AMOUNT);
    }
}
