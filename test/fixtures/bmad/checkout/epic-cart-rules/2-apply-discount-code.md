---
id: 2
type: story
title: "A shopper applies a discount code and sees the new total"
parent: epic-cart-rules
covers: [C2]
after: [1]
refined: true
hitl: false
risk: medium
---

# A shopper applies a discount code and sees the new total

## Description

A shopper enters a discount code and the total updates before tax.

## Acceptance Criteria

1. **Valid code reduces the total**
   **Given** a cart and a valid discount code
   **When** the shopper applies it
   **Then** the total drops by the code's value
2. **Expired code is refused with the reason**
   **Given** a cart and an expired code
   **When** the shopper applies it
   **Then** the total is unchanged and the message says the code expired
