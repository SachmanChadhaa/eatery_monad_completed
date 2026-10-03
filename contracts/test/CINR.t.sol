// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CINR} from "../src/CINR.sol";

contract CINRTest is Test {
    CINR internal t;
    uint256 internal studentPk = 0x57D;
    address internal student;
    address internal vault = address(0xBA11);

    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function setUp() public {
        vm.warp(1_790_000_000);
        t = new CINR();
        student = vm.addr(studentPk);
    }

    function test_metadata() public view {
        assertEq(t.decimals(), 2);
        assertEq(t.symbol(), "cINR");
    }

    function test_faucetAndCooldown() public {
        vm.prank(address(0xCAFE)); // relayed by the backend
        t.faucet(student);
        assertEq(t.balanceOf(student), 500_00);
        vm.expectRevert(abi.encodeWithSelector(CINR.FaucetCooldown.selector, block.timestamp + 1 days));
        t.faucet(student);
        vm.warp(block.timestamp + 1 days);
        t.faucet(student);
        assertEq(t.balanceOf(student), 1000_00);
    }

    function test_permitThenPull() public {
        t.faucet(student);
        uint256 amount = 45_00;
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, student, vault, amount, t.nonces(student), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(studentPk, keccak256(abi.encodePacked("\x19\x01", t.DOMAIN_SEPARATOR(), structHash)));

        vm.startPrank(vault); // the backend vault key submits both calls and pays the gas
        t.permit(student, vault, amount, deadline, v, r, s);
        t.transferFrom(student, vault, amount);
        vm.stopPrank();

        assertEq(t.balanceOf(vault), amount);
        assertEq(t.balanceOf(student), 500_00 - amount);
        assertEq(t.allowance(student, vault), 0);
    }
}
