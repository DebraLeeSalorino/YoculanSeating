# Ticket & Seating App — Specification

Nov 23, 2026 · @Debra · Revised Nov 24, 2026: Eventbrite orders are entered by hand (section 3.3)

## 1. Overview

The app lets event admins collect attendees, link them into groups, draw the room's tables, and produce a seating chart in which every group sits together. Admins place the people who matter by hand; the system seats everyone else.

**Users.** Staff in three roles, several at a time, working online in a browser: admins, ticket sellers and door staff (section 10.1). Customers never log in.

**Goals**

- Capture each customer's name, phone number and email, entered by staff, who take payment through Square inside the app, or entered by an admin from Eventbrite orders.
- Link customers into groups so separate ticket purchases can sit together.
- Lay out the room with tables of a chosen shape, size, angle and seat count.
- Let admins assign and lock people or groups to specific seats.
- Auto-seat all remaining groups into the remaining seats keeping each group at one table wherever it fits.

**Out of scope for version 1**

- Storing or handling card numbers. Square does that; the app starts the charge and records the result.
- Customers choosing their own seats.
- Badge printing.
- An automatic connection to Eventbrite. Eventbrite orders are entered by hand (section 3.3), and the design leaves room to automate this later (section 3.3.1).
- Automatic handling of seating preferences beyond grouping, such as "keep these two groups apart".

## 2. Core concepts

One rule governs everything below: a group is seated as a unit at one table whenever it fits, and across the fewest neighbouring tables when it does not.

| Term | Meaning |
| --- | --- |
| Customer | One person who needs one seat. Has a name and, optionally, a phone number and email. |
| Order | One ticket purchase, made in the app or on Eventbrite. An order for four tickets produces four customers. |
| Group | A set of customers who must sit together: at one table when they fit, otherwise at neighbouring tables. A customer with no group is treated as a group of one. |
| Room | The floor plan for one event: an oval or rectangle of known dimensions holding tables and room features. |
| Table | A shape placed in the room with a fixed number of seats. |
| Seat | One numbered position at a table. Holds at most one customer. |
| Assignment | The link between a customer and a seat. |
| Lock | A flag on an assignment that stops auto-seating from moving it. |
| Queue | Every group that is fully paid or comped and has no seats yet. Auto-seating draws from here. |
| Ticket type | Seated, which needs a seat, or Standing room, which never gets one. |
| Section | A named set of tables, either on general sale or reserved for sponsors or for friends and family. |
| Room feature | Something drawn on the floor plan that has no seats, such as the stage or the will-call table. |

## 3. Customer intake

Customers enter the system two ways: staff enter them in the app and take payment through Square or in cash, or an admin enters an order placed on Eventbrite. Both end in the same customer record.

### 3.1 Customer record

| Field | Required | Rules |
| --- | --- | --- |
| Name | Yes | Free text, 1 to 120 characters. |
| Phone number | No | Stored in a normalised international format; shown in local format. |
| Email | No | Validated for format. Used to spot duplicates. |
| Notes | No | Free text for the admin, such as "wheelchair user". |
| Sales channel | Yes | In-app sale or Eventbrite. For Eventbrite, the Eventbrite order number when the admin has it. |
| Ticket and payment | Yes | Ticket type, price, payment status, method and seller, as set out in section 3.5. |
| Allocation | Automatic | General, a sponsor or a reserved section, taken from the customer's group (section 5.6). |

### 3.2 Manual entry

- An admin can add, edit and delete a customer from the customer list.
- A quick-add row lets the admin enter several customers in a row without leaving the keyboard.
- When adding, the admin can place the customer in an existing group or start a new one.
- If the email matches an existing customer, the app warns and offers to open the existing record. It does not block, because one buyer may hold several tickets.
- Deleting a seated customer frees the seat. The rest of the group stays seated.

### 3.3 Eventbrite orders (entered by hand)

Eventbrite sells a few hundred tickets a year. An admin enters each Eventbrite order in the app as it comes in, the same way they record a cash sale. There is no automatic connection to Eventbrite in version 1.

- Only an admin can enter an Eventbrite order. Ticket sellers and door staff cannot choose Eventbrite as the channel.
- The admin chooses **Eventbrite** as the seller and the payment method, enters the buyer's name and, when known, email and phone, the ticket type and the number of tickets, and optionally the Eventbrite order number.
- The app creates one Paid customer per ticket, in one new group named after the buyer. Ticket holders' names can be typed in now; any left blank are named "Guest of \[buyer\]".
- If the buyer's email is entered, the buyer page link is emailed as for any other order (section 3.7), so the buyer can name their guests.
- If the order number matches one already entered, the app warns and offers to open the existing order. It does not block, so a missing number never stops entry.
- Eventbrite tickets count toward capacity like any other sale, under the normal limits in section 3.6.
- "Eventbrite" is a sales channel, not a user. Nobody signs in as it. It appears alongside the sellers in totals and reports.
- Eventbrite's own ticket limit and refund policy are set and watched by hand in Eventbrite. The refund policy should be no refunds, to match section 3.5. Eventbrite sales are kept small, and admins manage both channels as capacity nears full.

### 3.3.1 Future: automatic Eventbrite connection

Eventbrite may be connected automatically in a later version, so that orders, guest names and refunds arrive without anyone typing them, and so the app can keep Eventbrite's ticket limit in step with seats left. Version 1 is built so this can be added without changing existing records:

- Every order records its sales channel and, for Eventbrite, the Eventbrite order number, so an automatic import can recognise orders already entered by hand and skip them.
- Eventbrite orders already arrive as Paid, credited to the Eventbrite channel, in one group per order, which is what an automatic import would produce.
- Capacity is worked out in one place (section 3.6), so a later connection can read seats left from there to set Eventbrite's limit.

Basis for the later work: Eventbrite's [webhooks](https://www.eventbrite.co/platform/docs/webhooks) cover order and attendee changes, and its [API](https://www.eventbrite.com.au/platform/new/api) allows ticket capacity to be updated.

### 3.4 Selling and charging through Square

Staff sell tickets inside the app and Square takes the money. The app starts every Square charge itself, so each payment is tied to its tickets, its seller and the sales limit from the start.

| Situation | How the buyer pays | What staff choose |
| --- | --- | --- |
| At a sales point or the door | Card or phone on a Square Terminal | "Charge on terminal"; the amount appears on the paired terminal |
| In person, away from a terminal | Square's payment page, opened by scanning a code on the seller's screen | "Show payment code" |
| Buyer is not present | Square's payment page, from a link sent by email or text | "Send payment link" |
| Cash | Cash handed to staff | "Cash received"; the app also records it in Square |

- An admin connects the Square account once in Settings and pairs each Square Terminal with the event.
- A ticket becomes Paid only when Square confirms the payment. A declined or abandoned payment leaves it Unpaid.
- Every payment stores Square's reference, so the app's totals can be matched to Square's reports.
- Recording cash in Square as well keeps all takings in one place.
- Card numbers never pass through the app.
- Tickets should not be rung up on the Square till on its own. A sale made that way is not tied to a ticket, a seller or the sales limit.

Basis: Square's Terminal connection takes payments from [any web or mobile application](https://developer.squareup.com/docs/payments-overview), while its phone-reader and tap-to-pay options need a native app or a hand-off to Square's own app ([in-person options](https://developer.squareup.com/docs/in-person-payment-options)). Square Terminal does not take cash, so cash is [recorded through Square's payments service](https://developer.squareup.com/docs/terminal-api/overview).

### 3.5 Tickets, payment and refunds

Every customer holds one ticket with a type, a price and a payment status, so staff always know who has paid.

| Ticket field | Values |
| --- | --- |
| Ticket type | Seated or Standing room. |
| Price | Set per ticket type in Settings. An admin can change it on a single ticket. |
| Payment status | Paid, Unpaid, Complimentary or Refunded. |
| Payment method | Eventbrite, Square terminal, Square payment link or cash. |
| Sold by | The ticket seller credited with the sale, or the Eventbrite channel. |

**Payment**

- Eventbrite orders are entered as Paid (section 3.3).
- A seller adding customers either takes payment straight away (section 3.4) or saves the tickets as Unpaid.
- **No seat without payment.** A ticket can be given a seat only when it is Paid or Complimentary. A group enters the seating queue once every ticket in it is Paid or Complimentary; until then it is listed under "Awaiting payment".
- An unpaid ticket does not count toward capacity and holds no place. Payment is accepted only while a ticket of that type is still available; if seated tickets have sold out in the meantime, staff are told before any money is taken and can offer standing room if any is left.
- Admins, ticket sellers and door staff can take payment for an unpaid ticket at any time.
- When payment arrives before the event, the group joins the queue and is seated by an admin or by auto-seating in the usual way.
- When payment is taken at the door, the app at once proposes seats where the whole group fits, using the auto-seating rules. Door staff accept them or pick other seats on the floor plan, which offers only free seats at tables the group is allowed to use. If no table fits the whole group, the nearest-tables split is proposed. The seats are then confirmed and shown, the check-in completes, and admins are notified.

**Complimentary tickets**

- A ticket seller can comp tickets for friends and family. Every seller comp is pending until an admin approves it.
- A pending comp is not yet Complimentary, so it does not count toward capacity and the ticket cannot be seated. An admin cannot approve it if its section is already full.
- On approval the ticket becomes Complimentary and its group can be seated in the Seller friends and family section.
- If the admin declines, the ticket becomes Unpaid. The seller can then take payment for it or ask an admin to cancel it.
- Comps given by an admin, including sponsor and committee guests, need no further approval.
- Every comp records who gave it, whose guest it is and who approved it. Comps appear in each seller's totals.

**Refunds**

- Tickets are non-refundable as a rule. Ticket sellers and door staff have no refund action.
- An admin can refund a ticket to correct an error and must give a reason. The amount, reason, admin and time are saved.
- For a Square payment, the app sends the refund to Square itself. Cash is handed back and recorded. An Eventbrite order is refunded in Eventbrite, then an admin records the refund in the app with its reason. A refund made directly in Square is detected and waits for an admin to confirm it.
- A refunded customer loses their seat, their QR code stops working and their ticket goes back on sale. Their record is kept.

**Seller credit**

- A sale entered by a ticket seller is credited to that seller.
- Eventbrite orders are credited to the Eventbrite channel.
- Totals per seller and per channel are in the reports in section 9.1.

### 3.6 Capacity, sell-out and standing room

Seated tickets sell until every seat on general sale is sold. Standing-room tickets open only then, and when those are gone all sales stop.

**Limits**

- Seats on general sale are the seats at tables that are not reserved (section 5.6). Until the floor plan is drawn, an admin types this number in so that sales can start first.
- An admin sets the number of standing-room tickets in Settings. Zero means none are sold. The venue's total capacity starts at 1,400 people, and an admin can change it in Settings at any time. Seats on general sale, reserved seats and standing-room tickets together can never exceed it. A change takes effect at once: the sales limits and the warnings are recalculated. Capacity cannot be set below the number of tickets already sold.
- A ticket counts as sold once it is Paid or Complimentary. Unpaid tickets, pending comps and refunded tickets do not count.

**What happens at each stage**

| Stage | Selling in the app, including Eventbrite orders entered by an admin |
| --- | --- |
| Seated tickets available | Can sell seated tickets up to the number left |
| Seated tickets sold out | Seated tickets blocked; standing room opens |
| Everything sold out | All selling blocked, shown as "Sold out" |

Eventbrite's own ticket limits are kept small and adjusted by hand in Eventbrite. Admins watch both channels as capacity nears full and close Eventbrite sales themselves.

- A payment that would exceed what is left is refused before any money is taken.
- An Eventbrite order entered after the limit is reached is refused like any other sale. Its customers have already paid, so an admin raises capacity in Settings to fit them in, or refunds them in Eventbrite.
- A seat that returns to sale after sell-out is sold before any further standing-room ticket. An admin can instead move a standing-room customer into it.
- Releasing reserved tables to general sale (section 5.6) raises the limit and can reopen seated sales.

**Standing-room customers**

- They have no seat and never appear in the seating queue.
- They receive the same emailed ticket and QR code, marked "Standing room", and are checked in the same way.

**Warnings**

- **Nearly sold out.** When 90% of seats on general sale are sold, admins and ticket sellers see a warning with the number left and the number of unpaid tickets outstanding, since those may not all be honoured. An admin can change the percentage.
- **Groups cannot all sit together.** After every change to customers, groups, reserved tables or the layout, the app test-runs auto-seating in the background. If any group would have to be split or left without seats, admins see a warning naming those groups.
- **Large group at point of sale.** When a seller adds a group, the app shows the largest group that can still sit at one table and warns if this group is bigger.

### 3.7 Buyer page and guest details

Each buyer gets a private link to a page where they can name their guests and send requests, without creating an account.

- The link is emailed when the order is created, from any channel, if the buyer's email is known. Sellers and admins can resend it or copy it.
- The page lists every ticket in the order. For each additional ticket the buyer can enter a name and, optionally, a phone number and email.
- A ticket left blank stays listed as "Guest of \[buyer\]" everywhere: lists, floor plan, check-in and reports.
- Ticket sellers and admins can add or correct a guest's details at any time from the Customers screen.
- A guest given their own email receives their own seat email. Otherwise it goes to the buyer.
- The page also takes seating and accommodation requests (section 6.7) and, once seats have been emailed, shows each ticket's table and seat.
- The buyer cannot change the number of tickets, the group or the seats. Editing closes at a time the admin sets, by default when the event starts.

## 4. Groups

A group links customers, often from different purchases, so they are seated at the same table. Each customer belongs to at most one group.

**Actions**

- Create a group from selected customers, and either name it or let the system name it.
- Add a customer to a group or remove one from it.
- Merge two groups into one. This is how two separate ticket purchases get linked.
- Split a group into two.
- Dissolve a group, leaving its members as individuals.

**Naming**

- The name field is optional. Left blank, the system names the group.
- An automatic name is the first member's last name plus "party", such as "Rivera party". A second group with the same name becomes "Rivera party 2".
- Groups created from an Eventbrite order are named automatically after the buyer.
- An automatic name updates if the first member changes. A name typed by an admin never changes on its own.
- An admin can rename any group, or clear the name to return it to automatic.

**Rules**

- Group size is its member count. The queue and the floor plan always show it.
- A group larger than the largest table is seated across the fewest neighbouring tables that can hold it. The app does this itself; it never asks the admin to split it.
- Adding a member to a seated group: if the table has a free seat, the new member takes it. If not, the admin chooses between cancelling and sending the whole group back to the queue.
- Removing a member from a seated group frees that member's seat. The removed customer goes to the queue as an individual.
- Merging a seated group with an unseated one follows the add-a-member rule for each incoming member.
- Merging two groups seated at different tables sends the merged group to the queue, after confirmation.

**Groups across several tables**

- A group is split only when no single table can take all of it: it is larger than every table, or no table has enough free seats left.
- It uses the fewest tables possible, chosen closest together in the room, measured centre to centre.
- The parts are as large as possible, and nobody is left alone at a table when that can be avoided.
- It remains one group: one name, one colour, one lock, and it returns to the queue as a whole.

## 5. Room layout editor

Admins build the floor plan on a to-scale canvas, placing each table where it stands in the real room. The same canvas is later used for seating.

### 5.1 Room

- The admin chooses the room's outline, oval or rectangle, and sets its width and length in feet or metres. The canvas draws the outline to scale, and tables can sit at any angle to follow the curve of an oval room.
- The canvas supports zoom, pan and an optional snap-to-grid.
- One room per event in version 1.

### 5.2 Table properties

| Property | Detail |
| --- | --- |
| Label | Short name or number shown on the table, unique within the room. |
| Shape | Round, square or rectangle. |
| Size | Diameter for round; width and length for square and rectangle. Same unit as the room. |
| Position | Centre point in room coordinates. Set by dragging or typing. |
| Angle | Any rotation from 0 to 359 degrees, set with a rotate handle or typed. Holding Shift snaps to 15-degree steps. |
| Seat count | Whole number, 1 or more. Fixed per table. |
| Seat placement | Seats are spaced evenly around the edge. For rectangles the admin can turn individual sides off, for a table against a wall. |

### 5.3 Editing

- Add a table from a palette, then drag, resize and rotate it.
- Duplicate a table, or select several and move them together.
- Undo and redo every layout change.
- Tables that overlap each other or cross the room boundary are outlined as a warning. The layout still saves.
- Seats are numbered clockwise from the table's first seat, so "Table 4, Seat 3" is unambiguous.

### 5.4 Changes after seating has started

- Moving, rotating or resizing a table never changes who sits there.
- Lowering a seat count below the number of occupied seats is refused until the admin unassigns enough people.
- Deleting a table with people at it requires confirmation and returns every affected group to the queue.

### 5.5 Room features

Admins can draw the things guests navigate by, such as the stage, so the plan matches the real room.

- Ready-made types: stage, merchandise table, food vendor, will-call table, bar, entrance, exit and dance floor. A custom type takes any label.
- Each feature has a shape (rectangle or round), a size, a position, any angle, a label and a colour. It is placed, resized and rotated the same way as a table.
- Features have no seats and never affect seating or capacity.
- They appear on the floor plan, the printed chart and the public seat page, so a guest can find their table from the stage or the entrance.
- A table that overlaps a feature gets the same outline warning as overlapping tables.

### 5.6 Reserved tables and sections

Tables are grouped into sections, and a reserved section or sponsor table accepts only the people it is held for.

**Sections**

- A section is a named, colour-coded set of tables. Every table belongs to one section.
- Each event starts with four: General, Sponsors, Seller friends and family, and Committee friends and family. An admin can add, rename and recolour sections.
- General is on general sale. All other sections are reserved.

**Sponsor tables**

- An admin records each sponsor with a name and a contact, and reserves one or more whole tables for them.
- A sponsor's table shows the sponsor's name on the floor plan and on printed lists.

**Allocations**

- Every group has an allocation: General by default, a named sponsor, or a reserved section.
- A ticket seller can mark a group they add as their own friends and family. The group then records that seller as its host. The comp rules for these tickets are in section 3.5.
- Admins set sponsor and committee allocations, and record which committee member is the host.

**Seating rules**

- A reserved table takes only groups whose allocation matches it. A group with a reserved allocation is seated only at its sponsor's tables or in its section.
- These rules apply to drag-and-drop, table requests and auto-seating. An admin can override them for a single placement after a confirmation.
- Each reserved section and sponsor shows seats used against seats held. When one is full, the app says so and an admin either adds a table to it or moves the group to General.
- Reserved seats are not on general sale and do not count toward sell-out.
- An admin can release unused reserved tables to General at any time, which adds their seats to general sale.

## 6. Manual assignment, locks and the queue

An admin seats a group by dragging it from the queue onto a table. Manual placements are locked by default, so auto-seating works around them.

### 6.1 Assigning

Only a group whose tickets are all Paid or Complimentary can be seated (section 3.5). Any other group waits under "Awaiting payment" and cannot be dragged to a table, approved for a table request or auto-seated.

- Dragging a group onto a seat fills that seat and the nearest free seats at the same table, one per member.
- If the table has too few free seats for the whole group, the app offers to seat the rest at the nearest tables with free seats. The admin accepts or cancels.
- Within a table, the admin can drag a person to a different free seat or swap two people.
- Dragging a seated group to another table moves the whole group.
- A single member cannot be moved to a different table than the rest of the group. The admin must remove them from the group first.

### 6.2 Assignment states

| State | How it is reached | Auto-seating may move it |
| --- | --- | --- |
| In queue | New customer, unassigned, or displaced by a layout or group change | Yes, this is what it seats |
| Seated, unlocked | Placed by auto-seating and accepted | Yes, on a re-run |
| Seated, locked | Placed by an admin, or locked by an admin after auto-seating | No |

Locks apply to the whole group. An admin can lock or unlock any seated group, or lock everything at a table in one action.

### 6.3 Unassigning

- Unassigning a group frees its seats, clears its lock and returns it to the queue.
- Unassigning one member of a group unassigns the whole group, after confirmation.
- "Clear auto-seated" returns every unlocked group to the queue. "Clear all" also returns locked ones and asks for confirmation.

### 6.4 The queue

- Lists every unseated group with its name, size and members, largest first.
- Searchable by customer name, email or phone number.
- A header shows people seated, people waiting and seats free, updated live.

### 6.5 Emailing seats to customers

An admin can email seated customers their seat as a printable ticket with a scannable QR code, either to selected customers or to everyone who is seated.

**Sending**

- On the Customers screen or the floor plan, the admin selects customers, groups or tables and chooses "Email seats". "Email all seated" covers everyone with a seat.
- A confirmation step shows how many people will be emailed and lists anyone skipped: not seated, or no email address.
- A customer with no email of their own, such as an unnamed guest, is covered by the buyer's email for their order. With no buyer email either, they are skipped.
- One email goes to each address. When several customers share an address, that email carries a ticket for each of them.
- Each customer shows when their seat was last emailed. If the seat has changed since, they are marked "Seat changed since email" and can be filtered and re-sent in one step.
- Bounced or failed emails are shown against the customer.

**The ticket**

- The email shows the event name and date, the customer's name, group, table label and seat number.
- The same details are attached as a PDF, one ticket per page, laid out to print cleanly on Letter or A4.
- Members of a group split across tables each see their own table.

**The QR code**

- Each customer has one unique code that cannot be guessed and never changes.
- Door staff open the Check-in screen on a phone or tablet and scan the code with the device camera. The scan records the customer as arrived, with the time and the staff member, and shows their name, group, table and seat with the table highlighted on the floor plan.
- Scanning a code a second time records nothing new. It shows the seat again with "Already checked in" and the original time.
- The seat shown is the live one, so a ticket already sent stays correct after a seat change. If the customer has no seat, the arrival is still recorded and the screen says no seat is assigned.
- Staff can also check someone in by searching their name, and can undo a check-in made by mistake.
- A customer who scans their own code with a phone camera sees their table and seat only. Attendance is recorded only by a signed-in staff member, so nobody can mark themselves as arrived.
- That public page shows no phone number or email.

**Attendance**

- The Check-in screen shows arrived against expected, for the whole event and per table.
- On the floor plan, seats of customers who have arrived are filled in; the rest are outlined.
- The customer list can be filtered by arrived or not arrived, and the CSV export includes the arrival time.

**Customising the email**

- Each event has one email template that an admin edits in Settings: sender name, reply-to address, subject, an optional logo, and the message text with basic formatting.
- The text can include merge fields for customer name, group name, event name, event date, table and seat number.
- The assigned table, the seat number and the QR code always appear in a fixed block of the email and on the PDF. They cannot be removed from the template.
- The admin can preview the email as any seated customer and send a test to themselves before sending to customers.

### 6.6 Table requests

A ticket seller can request a table for a group, and nothing is seated until an admin approves it.

**Requesting**

- From a group or an ungrouped customer, the seller chooses "Request table", picks a table from the floor plan and can add a note, such as "near the stage, guest of the sponsor".
- A request is for a table, not for particular seats, and covers the whole group.
- A group has at most one open request. The seller can change or cancel it while it is pending.
- The seller sees each of their requests as Pending, Approved or Declined, with the admin's reason if one was given.

**Approving**

- Admins see a count of pending requests, a list of them with seller, group, size, table and note, and a marker on each requested table on the floor plan.
- Approve seats the group at the requested table and locks it, exactly like a manual placement by the admin.
- If the table lacks free seats for the whole group, the admin can approve to a different table, accept the nearest-tables split from section 6.1, or decline.
- Decline leaves the group in the queue and can carry a short reason for the seller.

**Rules**

- A pending request holds no seats. An admin can seat someone else at that table in the meantime.
- Auto-seating skips groups with a pending request and says how many it skipped, so requests are decided before those groups are placed.
- If an admin seats the group by hand, the request closes as approved or declined according to whether the table matches.
- If the requested table is deleted, the request is declined automatically with that reason.
- Each request records who asked, who decided and when.

### 6.7 Customer seating and accommodation requests

Customers can ask for a seating preference or an accommodation, and an admin decides what to do with each one.

- The buyer enters a request on the buyer page (section 3.7): tick-boxes for wheelchair space, step-free access, near an exit, near the stage and near another party, plus free text.
- A ticket seller or admin can enter a request on a customer's behalf.
- A request belongs to a group, or to one ticket when it concerns one person's access needs.
- Admins work through a requests inbox. Each request is Open, Done or Cannot accommodate, with a note.
- The buyer is emailed the outcome when the admin chooses to send it.
- A group with an open request carries a marker in the queue and on the floor plan, with the request text on hover.
- Auto-seating does not act on requests. Its preview lists the groups that have open requests so the admin can place and lock them first, or adjust afterwards.
- A request that arrives after the group is seated is marked "Received after seating".
- The buyer page states that requests are not guaranteed.

## 7. Auto-seating

Auto-seating places every group in the queue into the free seats, one table per group wherever possible, without touching locked assignments. It is a bin-packing problem: tables are bins with their free seats as capacity, and groups are items that are split only as a last resort.

### 7.1 Inputs

- Free seats per table, after locked assignments are counted.
- Every group in the queue, with its size.
- Whether to keep or redo existing unlocked placements. The default is redo.

* The fill style, chosen by the admin when starting a run: **Fill tables** packs people into as few tables as possible; **Spread evenly** shares them across all tables. Fill tables is the default, and the event remembers the last choice.

### 7.2 Hard constraints

1. Every member of a group sits at the same table, unless no single table can take the whole group.
2. No table receives more people than it has free seats.
3. Locked assignments do not move.
4. Each seat holds one person.

Two more constraints apply. A reserved table takes only groups allocated to its sponsor or section (section 5.6), and standing-room customers are never seated.

### 7.3 Objective

Among arrangements that meet the constraints, the algorithm prefers, in this order:

1. The most people seated, then the fewest groups split, then each split group on the fewest and closest tables.
2. The fewest tables left partly filled, so empty seats collect at whole empty tables, when the fill style is Fill tables. With Spread evenly, the smallest difference between tables in the share of seats filled instead.
3. Members of a group in neighbouring seats at their table.

### 7.4 Method

- Start with best-fit decreasing: take groups largest first and put each at the table where it leaves the fewest free seats. With Spread evenly, put each at the table with the lowest share of seats filled.
- If any group remains unseated, or the result can be improved, run a bounded search (backtracking or a constraint solver) for up to 5 seconds and keep the best arrangement found.
- Within a table, assign each group a run of adjacent free seats where one exists, otherwise the closest free seats.
- The same inputs always produce the same result.

Splitting: groups that still do not fit whole are placed last, largest first. Each takes the cluster of tables, closest together centre to centre, that seats it in the fewest tables. Seats are shared out so the parts are as large as possible and nobody sits alone where that can be avoided.

### 7.5 Running it

- The result appears as a preview on the floor plan, with new placements highlighted. The admin accepts or discards it. Nothing is saved until accepted.
- Accepted placements are unlocked, so a later run may rearrange them. The admin can lock any they want to keep.
- A single undo reverses an accepted run.

### 7.6 When not everyone fits

Because groups can be spread over tables, a group stays in the queue only for these reasons:

- **Room is full:** fewer free seats remain than people waiting. Groups are seated largest first until no waiting group fits in the seats left. The app never seats part of a group and leaves the rest waiting.
- **Its tables are full:** the group's sponsor tables or reserved section have too few free seats left, even if General seats are free (section 5.6).
- **It has a pending table request:** the group is skipped until an admin decides the request (section 6.6).

The run summary states how many people were seated, how many remain and why, how many seats are still free and which groups were split across tables.

## 8. Data model

Seventeen entities cover the app. Every record also carries an id, created and updated timestamps, and the admin who last changed it.

| Entity | Key fields | Relationships and constraints |
| --- | --- | --- |
| Event | name, date, room width, room length, unit, email template, auto-seat fill style, room outline, ticket prices, standing-room ticket count, venue capacity, sell-out warning percentage, typed-in general-sale seat count, sales open, scheduled sales opening, status (live or closed), buyer page editing deadline | Owns everything below. A closed event is read-only (section 15). |
| Customer | name, phone, email, notes, contact, ticket code, seat last emailed, checked in at, checked in by, ticket type, price, payment status, sold by, comp host, comp approved by | Belongs to one event and one contact; optionally to one group and one order. |
| Order | sales channel (app or Eventbrite), Eventbrite order number (optional), buyer name, buyer email, buyer phone, ticket quantity, ticket type, sold by, buyer page code | A repeated Eventbrite order number within an event triggers a warning (section 3.3). Has many customers. |
| Group | name, name is automatic, allocation (General, a section or a sponsor), host | Has one or more customers. Deleted automatically when its last member leaves. The host is the seller or committee member whose friends and family it is. |
| Table | label, shape, width, length, x, y, angle, seat count, disabled sides, section, sponsor | Label is unique per event. Has many seats. |
| Seat | number | Belongs to one table. Position is calculated from the table's shape and seat count, not stored. |
| Assignment | customer, seat, locked, placed by (admin or auto) | One per customer and one per seat at most. All assignments in a group share one lock value and point to seats at one table, or at neighbouring tables when the group is split. |
| Admin | name, email, password hash, role per event, invited by | Any signed-in user. Holds one role (admin, ticket seller or door staff) in each event they can access. Email is unique. |
| Square connection | location, paired terminals | One per event at most. The access token is kept in the hosting service's encrypted secret settings, not the database, and is never shown after setup. |
| Table request | group, table, note, status, requested by, decided by, decided at, reason | At most one pending request per group. Status is pending, approved, declined or cancelled. |
| Section | name, colour, reserved or general | Has many tables. A group's allocation points to a section or a sponsor, with an optional host. |
| Sponsor | name, contact, confirmed for this year | Has one or more reserved tables. Copied sponsors start unconfirmed (section 15). |
| Room feature | type, label, shape, width, length, x, y, angle, colour | Belongs to one event. No seats. |
| Payment | customer, kind (payment or refund), amount, method (Square terminal, Square payment link, cash or Eventbrite), reason, taken by, time, Square reference | A customer's payment status is worked out from these records. Records are never deleted. |
| Customer request | group or customer, needs ticked, text, status, note, entered by, decided by | Status is open, done or cannot accommodate. |
| Notification | user, type, subject record, read, emailed | One per user per event that concerns them (section 10.2). |
| Contact | name, phone, email | One person across all years, kept indefinitely. Each year's Customer record links to a Contact, matched by email or phone. |

The queue is not stored. It is every group whose customers have no assignment.

An Eventbrite connection entity, holding credentials, the linked Eventbrite event and its ticket types, is added only if the automatic connection in section 3.3.1 is built.

## 9. Screens

The app has seven staff screens and two public pages, and the floor plan is where admins spend most of their time.

| Screen | What the admin does there |
| --- | --- |
| Customers | Lists customers with name, phone, email, group and seat. Add, edit, delete, search, filter by seated or waiting, and select several to group or to email their seats. Ticket sellers request a table from here. |
| Floor plan: Layout mode | Set room size; add, shape, size, rotate and place tables. |
| Floor plan: Seating mode | Queue panel on the left, room on the right. Drag groups to seats, lock and unlock, run auto-seat, accept or discard the preview. Approve or decline table requests. |
| Export | Download the seating chart as a printable floor plan, a list by table and an alphabetical list by customer; download customers, with attendance, as CSV. |
| Settings | Invite and remove users and set their roles, connect Square and pair its terminals, and set ticket prices and limits. |
| Check-in | Scan a customer's QR code with the device camera to record arrival and see their table and seat. Search by name, undo a check-in, and watch arrived against expected. |
| Sales | Sell tickets and take payment; admins enter Eventbrite orders and see refunds made directly in Square; approve pending comps; see tickets sold against the limits, the sell-out warnings, unpaid tickets, and totals by seller and by channel. Admins record refunds here. |
| Requests | One inbox for sellers' table requests and customers' seating and accommodation requests, each with its status. |
| Buyer page (public) | Reached by private link. The buyer names guests, adds their contact details and sends requests. |
| Seat page (public) | Reached by scanning a ticket's QR code without signing in. Shows the table and seat on the floor plan with the room features. |

**Floor plan display**

- Each seat shows the occupant's initials; hovering or tapping shows the full name and group.
- Members of one group share a colour, so a group reads as a block at a glance. A split group is joined by a line between its tables.
- Locked seats carry a lock icon. Auto-seat previews are outlined until accepted.
- Each table shows its label and a count such as 6/8.
- Selecting a customer anywhere in the app highlights their seat on the plan.

### 9.1 Printable lists and exports

Every list below is available as a print-ready PDF and as a spreadsheet download.

| List | Order | Columns |
| --- | --- | --- |
| Customers by name | Alphabetical by name | Name, group, table, seat, ticket type, payment status, arrived |
| Customers by table | Table number, then seat number | Table, section or sponsor, seat, name, group, payment status |
| Floor plan | Not applicable | The room drawn to scale with tables, labels, sections and room features |
| Unpaid tickets | Alphabetical by name | Name, group, amount due, seller, table and seat |
| Sales totals | By seller, then by channel | Seated and standing-room tickets sold; amounts paid, unpaid, complimentary and refunded |
| Requests | By status | Group, request, status, note |

- Any list can be limited to one section, one sponsor or one table.
- Unnamed tickets print as "Guest of \[buyer\]" and sort under the buyer's name.
- Each printout carries the event name and the time it was produced, since seating can change afterwards.
- Admins see sales totals for everyone. A ticket seller sees only their own.
- The by-name list doubles as a paper check-in sheet if the venue's internet fails.

## 10. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Access | Each user has their own account, joins by email invitation and signs in with email and password. A "Forgot password" link emails a single-use reset link that expires after one hour; admins can trigger a reset for a user and never see a password. There is no two-factor sign-in. Each user holds one of three roles for an event (section 10.1). |
| Privacy | Names, phone numbers and emails are encrypted in transit and at rest, visible only to signed-in admins and ticket sellers, and kept indefinitely, so returning customers are recognised each year. An admin can still delete one customer's details if that person asks. |
| Scale | One event of up to 2,000 customers and 250 tables stays responsive. That covers the venue's capacity of about 1,400 with headroom. |
| Performance | Dragging on the floor plan feels immediate. Auto-seating returns within 5 seconds at the scale above. |
| Saving | Every change saves automatically. Undo and redo cover layout and seating actions in the current session. |
| Concurrent admins | Several admins can work on the same event at once, from different places. Changes appear for the other within a few seconds; if both edit the same record, the later save wins and the other admin is told. |
| Devices | Built for desktop browsers. The floor plan is usable on a tablet with touch. Check-in scanning works in a phone browser. |
| Audit | Each assignment records who placed it, or that auto-seating did. |
| Online | A hosted web app. Nothing is installed, all data lives on the server, and any admin can reach it from a browser with an internet connection. No offline mode in version 1. |

### 10.1 Roles

Three roles control what each signed-in person can do: admins run everything, ticket sellers add the people who buy, and door staff check them in.

| Capability | Admin | Ticket seller | Door staff |
| --- | --- | --- | --- |
| Add and edit customers and groups | Yes | Yes | No |
| Delete customers and groups | Yes | No | No |
| See customers' phone numbers and emails | Yes | Yes | No |
| Enter Eventbrite orders | Yes | No | No |
| Edit the room layout | Yes | No | No |
| Assign, lock, unassign and auto-seat | Yes | No | No |
| View the floor plan and who sits where | Yes | Yes | Yes |
| Email seats and edit the email template | Yes | No | No |
| Scan QR codes and check customers in | Yes | No | Yes |
| Export the chart and CSV | Yes | No | No |
| Manage users, roles and the Square connection | Yes | No | No |
| Request a table for a group | Not needed | Yes | No |
| Approve or decline table requests | Yes | No | No |
| Take payment for a ticket, through Square or in cash | Yes | Yes | Yes |
| Refund a ticket, or comp one outside seller friends and family | Yes | No | No |
| See sales totals | Everyone's | Own only | No |
| Enter a customer's seating or accommodation request | Yes | Yes | No |
| Decide customer requests | Yes | No | No |
| Manage sections, sponsors, reserved tables and room features | Yes | No | No |
| Comp a seller friends-and-family ticket | Yes, and approves pending comps | Yes, pending admin approval | No |
| Accept or choose seats for a group paying at the door | Yes | No | Yes |

- A user has one role per event, set by an admin when inviting them and changeable later.
- Every event keeps at least one admin; the last admin cannot be removed or demoted.
- Screens and buttons a role cannot use are hidden, and the server refuses the action if it is attempted anyway.
- Elsewhere in this spec, "admin" describes the action; this table decides which roles may perform it.

**Removed users**

- Removing a user ends their access at once and deletes nothing.
- The customers, sales, payments, requests and seat placements they made all stay, still shown under their name.
- Their sales stay in the totals, and their pending table requests stay pending for an admin to decide.
- Re-inviting the same email address restores the account with its history.

### 10.2 Notifications

Staff are told about things that need them, in the app and, for the urgent ones, by email.

| What happened | Who is told | How |
| --- | --- | --- |
| A seller sent a table request | Admins | In app and email |
| A table request was approved or declined | The seller who asked | In app and email |
| A customer sent a seating or accommodation request | Admins | In app and email |
| A customer request was decided | The buyer | Email, when the admin chooses to send it |
| An order was created | The buyer | Email with the buyer page link |
| Seats are nearly sold out | Admins and ticket sellers | In app |
| Seated tickets sold out and standing room opened | Admins, ticket sellers and door staff | In app and email |
| Everything is sold out | Admins and ticket sellers | In app and email |
| Not every group can be seated together | Admins | In app |
| A refund was made directly in Square | Admins | In app and email |
| Square disconnected | Admins | In app and email |
| A seat changed after it was emailed | Admins | In app |
| An email to a customer bounced | Admins | In app |
| A seller comped a friends-and-family ticket | Admins, then the seller once decided | In app and email |
| A group paid at the door and was seated there | Admins | In app |
| A group became fully paid and joined the seating queue | Admins | In app |

- In-app notifications sit in a list with an unread count and link to the record concerned.
- Each user can switch email off for any type. In-app notifications cannot be switched off.

## 11. Assumptions and open questions

The requirements were silent on the points below. Each line states what this spec assumed; tick it once confirmed or change the section it names.

- [x] Eventbrite orders are entered by hand by an admin, credited to the Eventbrite channel; an automatic connection may follow later (section 3.3).
- [x] Eventbrite's ticket limit is kept small and watched by hand; the app does not manage it (section 3.6).
- [ ] Every ticket is one seat, and guests without names are created as "Guest of \[buyer\]" (section 3.3).
- [ ] Groups are also split when no table has enough free seats left, not only when they are larger than every table; "neighbouring" means closest centre to centre (section 4).
- [ ] Manual placements are locked automatically (section 6).
- [ ] Fill tables is the default fill style, and admins can switch to Spread evenly on any run (section 7.1).
- [ ] Table shapes are round, square and rectangle only (section 5.2).
- [ ] The room outline is an oval or a rectangle; no other outline is needed (section 5.1).
- [ ] Two events can be live at once: this year's, and next year's once its sales open (section 15).
- [ ] Ticket sellers add buyers and take payment through Square in the app; they do not seat anyone (section 10.1).
- [ ] Venue capacity is planned at 1,400 and admins can change it; the app is sized for 2,000 customers and 250 tables (sections 3.6 and 10).
- [ ] Door staff each sign in with their own account to scan; a customer scanning their own code sees their seat but is not marked as arrived (section 6.5).

* [ ] Every Square payment starts in the app; tickets are not rung up on the Square till on its own (section 3.4).
* [ ] For a ticket paid at the door, the app proposes seats and door staff may choose others that are free (section 3.5).
* [ ] An unpaid ticket holds no place; if seated tickets sell out first, it can be paid only as standing room, if any is left (section 3.5).
* [ ] Automatic group names follow the "Rivera party" pattern (section 4).
* [ ] The app needs an internet connection at the venue; no offline mode (section 10).

- [ ] A table request holds no seats while it waits for approval (section 6.6).
- [ ] Sellers request a table, not specific seats (section 6.6).

* [ ] Cards are charged through Square from inside the app, on a Square Terminal or by payment link (section 3.4).
* [ ] Admins refund Square payments from inside the app; Eventbrite orders are refunded in Eventbrite and then recorded in the app (section 3.5).
* [ ] Sponsor and other free tickets are marked Complimentary by an admin (section 3.5).
* [ ] Standing room has a fixed ticket count set by an admin (section 3.6).
* [ ] The nearly-sold-out warning starts at 90% (section 3.6).
* [ ] Buyers reach their page by a private emailed link, with no account (section 3.7).
* [ ] Every seller comp waits for an admin's approval, and a declined comp becomes an unpaid ticket (section 3.5).
* [ ] Customer requests are handled by an admin by hand and are not used by auto-seating (section 6.7).

- [ ] A declined seller comp becomes an unpaid ticket in General, since a paying guest no longer belongs in Seller friends and family (section 3.5).
- [ ] A reserved section's seat limit applies once its tables are drawn; before the floor plan exists, comps there are limited only by venue capacity (sections 3.5 and 5.6).
- [ ] Each event has a venue time zone in Settings, used for every date and time shown to buyers (section 3.7).

- [ ] Next year's event is made by copying this year's, and its sales are opened by an admin's switch or at a scheduled time (section 15).
- [ ] Sponsor table reservations carry over as "to confirm" rather than being cleared or kept automatically (section 15).
- [ ] A returning customer is matched by email or phone number (section 15).

## 12. Delivery phases and acceptance

Tickets must go on sale almost a year before anyone needs a seat, so the build runs sales first: four releases, each usable on its own, for an event in November 2027.

1. **Sales.** The hosted web app with accounts, roles and password reset; customers, groups and tickets; Square charging; manual entry of Eventbrite orders; capacity, sell-out and standing room; comps with approval; the buyer page; seller totals.
2. **Room.** The oval room editor, tables with shape, size, angle and seat count, room features, sections and sponsor tables.
3. **Seating.** The queue, drag-to-seat, locks, table requests, customer requests, auto-seating with preview, the cannot-seat-together warning, and the printable lists.
4. **Event night and next year.** Customisable seat emails with QR codes, door check-in and door payments, notifications, and copying the event so next year's sales can open on the day.

The dates below are targets. They assume the open decisions in sections 13 and 14 are settled in December 2026.

| When | What happens |
| --- | --- |
| Now, before the app exists | Open sales on Eventbrite with a cautious ticket limit and the no-refund policy. Settle the open decisions and set up the Square, email and hosting accounts. |
| December 2026 to January 2027 | Build release 1, Sales. At go-live admins enter every Eventbrite order already placed and staff start selling through Square in the app. |
| February to April 2027 | Build release 2, Room. Capacity switches from the typed-in seat count to the drawn floor plan. |
| May to July 2027 | Build release 3, Seating. Admins begin placing sponsors and reserved sections. |
| August to September 2027 | Build release 4, Event night and next year. |
| October 2027 | Dry run with real staff, a Square Terminal and a real payment. Train sellers and door staff. Finish seating and send seat emails. |
| November 2027 | The event. Next year's event is copied and its sales open that day. |

Two rules make early sales possible: the seat count can be typed in before the floor plan exists (section 3.6), and Eventbrite orders placed before the app exists are entered by hand at go-live (section 3.3).

**Acceptance criteria**

- A customer can be created with only a name, and edited to add phone and email.
- An admin entering an Eventbrite order of four tickets creates four Paid customers in one group, credited to Eventbrite; entering the same order number again shows a warning. A ticket seller cannot choose Eventbrite.
- Two groups from separate orders can be merged and are then seated at one table.
- A rectangular table for 8 can be placed at a 37-degree angle, saved, and reopened in the same place.
- A group of 5 dropped on a table with 4 free seats prompts the admin to seat the rest at the nearest table or cancel.
- Unassigning a seated group puts all of its members back in the queue and frees their seats.
- After auto-seating, no group is split across tables unless no single table could take it, no table is over capacity and no locked assignment has moved.
- With 100 free seats and 100 queued people in groups that can fit, auto-seating seats all 100.
- A group of 14 in a room of tables for 8 is seated at two tables that are next to each other.
- Discarding an auto-seat preview leaves the chart exactly as it was.

* A seller's sale of three tickets charged on a Square Terminal is saved as Paid with Square's reference; a declined card leaves the tickets Unpaid.
* A group created with no name is shown with an automatic name; typing a name replaces it, and clearing the name restores the automatic one.
* Two admins signed in on different computers each see the other's seat assignment within a few seconds, without refreshing.

- Selecting three seated customers and choosing "Email seats" sends each a ticket with their table, seat and a QR code; "Email all seated" sends to every seated customer with an address and lists those skipped.
- The attached PDF prints one ticket per page with a QR code that scans from paper.
- After a customer is moved to another seat, scanning the QR code from the earlier email shows the new seat.

* A signed-in staff member scanning a ticket's QR code sees the customer's table and seat and the customer is marked as arrived; scanning it again shows "Already checked in" and adds no second record.
* Scanning the same code with a phone that is not signed in shows the table and seat and records no attendance.
* Changing the email subject and message in Settings changes the next email sent, which still shows the assigned table, seat number and QR code.

- A door staff user can scan and check in customers and view the floor plan, and cannot see phone numbers or emails or change any seat.
- A ticket seller can add a customer and a group, and cannot move a seat, send emails or open Settings.
- The last admin of an event cannot be removed or given another role.

* A ticket seller's table request appears in the admin's pending list and on the floor plan; approving it seats and locks the group at that table, and the seller sees "Approved".
* Declining a request leaves the group in the queue and shows the seller the reason.
* Auto-seating leaves a group with a pending request in the queue and reports it as skipped.

- With 40 people in groups of 4 and ten empty tables of 8, Fill tables leaves five tables full and five empty; Spread evenly puts 4 at every table.

* A seller cannot save a customer without choosing Paid or Unpaid, and the sale appears in that seller's totals.
* With 200 seats on general sale, the 181st paid or comped seated ticket triggers the nearly-sold-out warning, payment for a 201st is refused, and unpaid tickets do not change the count.
* Standing-room tickets cannot be added while a seated ticket is still available, and can be once seated tickets are sold out.
* Scanning an unpaid ticket shows the amount due; after door staff take the payment, the app proposes seats where the group fits, door staff accept them or choose other free seats, and the customer is checked in.
* Only an admin can refund a ticket, a reason is required, and the refunded customer's seat becomes free.
* A general group cannot be dropped on a sponsor's table without an admin override, and auto-seating never places one there.
* An oval room with a stage, merchandise table, food vendor and will-call table can be drawn, saved and printed.
* A buyer of four tickets can name two guests on the buyer page; the other two are listed as "Guest of \[buyer\]", and a seller can fill them in later.
* A request sent from the buyer page appears in the admin's inbox and marks the group in the queue.
* The by-name and by-table lists each print as a PDF and download as a spreadsheet with matching rows.
* After a user is removed, the customers they added and their sales totals are unchanged.
* A user who has forgotten their password can set a new one from an emailed link, and the link works once.

- A group with one unpaid ticket cannot be dragged to a table and is skipped by auto-seating; once that ticket is paid or comped, the group appears in the queue.
- A seller's comp stays pending and cannot be seated until an admin approves it; a declined comp becomes Unpaid.
- An admin's refund of a Square payment appears in Square without anyone opening Square.

* "Create next year's event" produces a new event with the same room, tables, features, sections, prices and users, and with no customers or seat assignments.
* With both events live, a ticket sold for next year on a Square Terminal appears only in next year's totals, while check-in for this year carries on.
* Adding a customer whose email matches a past attendee fills in their details and shows the years they attended.
* A past event can be opened and its lists exported, and nothing in it can be changed.

- A rebooked group of six can be changed to four or to eight before payment, and the amount due changes to match.

* An admin can change the venue capacity from 1,400; the tickets left update at once, and a figure below the number already sold is refused.

## 13. Email sending setup

How email is sent is not settled yet. The app sends six kinds of email, and the decisions below are needed before that part is built.

| Email | Goes to | Sent when |
| --- | --- | --- |
| Buyer page link | Buyer | An order is created |
| Seat ticket with QR code | Customer or buyer | An admin sends seats |
| Request outcome | Buyer | An admin decides a request and chooses to send |
| Staff notification | Admins, sellers, door staff | The events in section 10.2 |
| Invitation | New user | An admin invites them |
| Password reset | User | They ask for one |

**Decisions to make**

- [x] Decided: the app lives at `yoculantickets.com`. Email comes from `Yoculan Tickets <tickets@yoculantickets.com>`. The domain is registered at GoDaddy and its DNS is managed there by the owner.
- [x] Decided: DKIM through Amazon SES, SPF on the sending sub-domain `mail.yoculantickets.com` (the domain's own SPF record for its GoDaddy mailbox is left unchanged), and a DMARC record. Steps are in `docs/deploy.md`.
- [x] Decided: Amazon SES.
- [x] Decided: replies go to `admin@yoculantickets.com`, read by the owner.
- [ ] Which emails admins can customise. Today it is the seat ticket; the buyer page link is a likely second.
- [ ] The no-refund wording and any footer the emails must carry, such as a postal address.
- [ ] Whether any email needs an unsubscribe link, or all count as transactional.
- [ ] How bounces and spam complaints are handled beyond the flag on the customer.
- [ ] Sending limits, so "Email all seated" for 1,400 customers goes out without being throttled.

## 14. Project-level items to review

These sit outside the feature list and need a decision from the project owners.

- [ ] Decided: the app is built with Claude Code, using this spec and its acceptance criteria as the brief. Decided: @Debra maintains it after launch and is an admin. GitHub, Eventbrite and Square accounts already exist. Still open: the budget and the email service (section 13). The first event is in November 2027, with tickets on sale as soon as possible.
- [ ] Decided: TypeScript, Next.js and Postgres, hosted on Render, with Render's daily database backups. Still open: how quickly the app must be restored after a failure.
- [ ] Decided: customer details are kept indefinitely. The privacy notice on the buyer page must say so.
- [ ] Eventbrite: set each event's ticket limit and no-refund policy by hand, and agree who enters Eventbrite orders and how often. Test the API only if the automatic connection (section 3.3.1) is taken up.
- [ ] Square: decide how many Square Terminals are needed for sales points and the door, and test payment links for remote sales. The organisation is on Square's Free plan, which is all the app needs.
- [ ] Decided: venue internet is generally reliable, so there is no offline mode. The printed by-name list is the fallback.
- [ ] Decided: the event is annual at the same venue, and next year's sales open on the day of this year's event (section 15).
- [ ] The privacy notice and terms shown on the buyer page, including the no-refund policy.
- [ ] Decided: no two-factor sign-in.
- [ ] A dry run with real data before the first live event.

## 15. Yearly events and early sales

The event runs once a year at the same venue with much the same seating plan. Each year's event is therefore created by copying the last one, and next year's sales can open on the day of this year's event.

**Creating next year's event**

- An admin chooses "Create next year's event" and sets its date.
- Copied across: the room outline, tables, seat counts, room features, sections, ticket prices, the standing-room count, the warning percentage, email templates, users with their roles, and the Square connection with its terminals.
- Not copied: customers, groups, orders, payments, seat assignments, requests and attendance.
- Sponsor table reservations are copied as "to confirm", and an admin keeps or releases each one.
- If next year's tickets will also sell on Eventbrite, an admin creates that event in Eventbrite by hand.
- The copied floor plan can be edited freely without changing the earlier year.

**Two events live at once**

- Once next year's event opens for sale, both events are live. A switcher at the top of every screen shows which event the user is in, and every selling screen names the event year prominently.
- An admin opens and closes sales for each event with one switch. Opening can be scheduled for a date and time, such as the morning of this year's event.
- This year's event carries on unchanged: check-in, door payments and seating.
- Staff sell next year's tickets on the same Square Terminals. Each payment is tagged with its event, so the two years' totals stay separate.
- Next year's tickets sell against next year's limits, taken from the copied floor plan. Paid groups wait in next year's queue and can be seated at any later time.
- Emails and tickets name the event year.

**Returning customers**

- Each person keeps one contact record across the years, and it is kept indefinitely.
- When staff add a customer, the app matches on email or phone number, fills in the known details and shows the years they attended and their last group and table.
- "Rebook last year's group" creates the same group in the new event with its tickets Unpaid, ready for payment. Until payment is taken, staff can add tickets, remove tickets and change who is in the group, and the amount due follows the new size. Only the tickets paid for are kept.

**Past events**

- A past event becomes a read-only archive once an admin closes it. Its lists, floor plan, attendance and sales totals stay viewable and exportable.
