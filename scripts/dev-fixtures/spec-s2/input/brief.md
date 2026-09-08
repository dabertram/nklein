# Field Service Dispatch — domain brief

We send engineers to fix things in other people's buildings. Right now that is a whiteboard, a WhatsApp group and
a filing cabinet of access codes; the plan is to put an API in front of it so the scheduling team, the van app and
the customer portal all talk to the same thing instead of to each other.

This brief describes the domain and what the API has to be able to do. It deliberately does not describe the API:
no endpoints, no payloads, no field names. Those are the decisions the specification has to make, and they are the
decisions we will argue about, so they need to be written down somewhere arguable.

## How the work actually goes

A **site** is a building we are allowed into: an address, a contact, and the access notes that stop an engineer
standing outside a locked gate at 07:00. Sites outlive everything else in the system and their access notes go
stale constantly, so keeping them current is a first-class job rather than an afterthought.

A **work order** is something that needs doing at a site — a fault, a service visit, an install. It is raised long
before anyone knows who will do it, and it carries a status from the moment it is raised until it is closed.

An **appointment** is a promise: this technician, at this site, in this window. Appointments are made against a
work order, they move constantly, and when one moves the customer has to be told. A technician can only take an
appointment they are qualified for — the skills on the work order have to be skills the technician holds.

**Parts** are consumed from van stock. They get reserved against a work order optimistically, days before the
visit, and reconciled against what was actually fitted when the job is closed. The gap between reserved and
consumed is where the money leaks.

A **technician** has a home depot, a skill set and a working day. Everything the scheduling team does is really an
argument about a technician's day.

## Domain nouns

These are the things the API has to model. Every one of them needs to exist in the specification as an entity in
its own right, spelled exactly as it is spelled here.

- **Site** — a building we are allowed into, with its contact and access notes.
- **WorkOrder** — something that needs doing at a site, from raised to closed.
- **Appointment** — a promise of a technician at a site in a window, made against a work order.
- **Part** — a stock item that can be reserved against a work order and consumed on a visit.
- **Technician** — an engineer with a depot, a skill set and a working day.

## Required capabilities

These are the things a caller must be able to do. Each one has to be served by at least one operation in the
specification; how you carve them into operations is your decision, and one operation may serve more than one
capability only in the sense that you may cite the capability it primarily serves.

- **CAP-01** — register a site and keep its access notes current.
- **CAP-02** — raise a work order against a site, with the skills the job needs.
- **CAP-03** — schedule an appointment for a work order with a technician who holds those skills.
- **CAP-04** — move or cancel an existing appointment.
- **CAP-05** — reserve parts against a work order from van stock.
- **CAP-06** — close a work order, recording which parts were actually consumed.
- **CAP-07** — list one technician's appointments for one day.
- **CAP-08** — find work orders by site and status.

## Things that will go wrong

Not an exhaustive list, and not a specification of error handling — just the failures the scheduling team hits
weekly, so that a specification which pretends they cannot happen is obviously incomplete. Sites get decommissioned
while work orders are still open against them. Technicians go sick and their day has to be emptied. A part is
reserved twice because two people were looking at the same stock figure. An appointment is moved to a window the
site is not open in. A work order is closed twice by two different people. Somebody asks for a technician who does
not exist.
