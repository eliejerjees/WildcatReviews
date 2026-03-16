# Davidson RMP

Chrome extension that displays **RateMyProfessor ratings directly on the Davidson College course schedule**.

When browsing the Davidson course schedule, instructor names automatically show their:

- ⭐ Average rating  
- 📊 Difficulty  
- 🔁 Would take again %  
- 📝 Recent reviews  

Clicking a professor’s name opens their full RateMyProfessor profile.

---

## Features

- Displays professor ratings inline on the Davidson course schedule
- Color-coded instructor names based on rating
- Hover tooltip showing:
  - average rating
  - difficulty
  - number of ratings
  - would take again percentage
  - recent reviews
- Direct link to the professor's RateMyProfessor page
- Handles edge cases such as:
  - multi-word last names
  - first-initial listings
  - name typos
  - instructors listed as `LastName F`
- Local caching to reduce repeated API requests

---

## Installation (Development)

1. Clone or download the repository

```bash
git clone https://github.com/yourusername/davidson-rmp