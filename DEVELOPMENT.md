# Development Setup Guide

## Quick Start
1. Clone the repository: `git clone https://github.com/Fatma929/tefnut-admin-portals.git`
2. Navigate into the project directory: `cd tefnut-admin-portals`
3. Install dependencies: `pip install -r requirements.txt` for Python and `npm install` for Node.js.
4. Run the development server: 
   - For Python: `python manage.py runserver`
   - For Node: `npm start`

## Python Development
- **Installing Requirements:** Make sure to use a virtual environment and run the command:
  ```
  pip install -r requirements.txt
  ```
- **Running Tests:** Use the command:
  ```
  pytest
  ```
- **Debugging:** Use an integrated development environment (IDE) like PyCharm or VSCode with breakpoints.

## Frontend Development
- **Node Setup:** Ensure Node.js is installed. Use `npm install` to install dependencies.
- **Dev Server:** Start the frontend with:
  ```
  npm start
  ```
- **Hot Reload:** Changes to the code will automatically reload the dev server.

## Database Setup
- **PostgreSQL Initialization:** Start by creating a database:
  ```
  createdb tefnut_db
  ```
- **Migrations:** Run migrations with:
  ```
  python manage.py migrate
  ```
- **Seeding:** To seed the database, run:
  ```
  python manage.py loaddata initial_data.json
  ```

## Pre-commit Setup
Install pre-commit hooks by running:
```bash
pre-commit install
```

## Running Full Test Suite
Run all tests using:
```bash
pytest tests/
```

## Docker Setup
- Ensure Docker is installed.
- Build the Docker image:
  ```
  docker build -t tefnut-admin-portals .
  ```
- Run the Docker container:
  ```
  docker run -p 8000:8000 tefnut-admin-portals
  ```
