// Task indexing and migration module
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

mod index;
mod migration;

#[cfg(test)]
mod migration_test;

pub use index::{IndexStats, TaskIndex, TaskQuery, TaskRecord};
pub use migration::{TaskMigrationConfig, TaskMigrationManager, TaskMigrationReport};
